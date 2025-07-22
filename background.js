// Background service worker for PiP Master extension

// Initialize extension APIs when available
function initializeExtension() {
    console.log('PiP Master extension installed');
    
    // Create context menu for videos (with error handling)
    if (chrome.contextMenus) {
        try {
            chrome.contextMenus.create({
                id: 'pip-master-context',
                title: 'Enable Picture-in-Picture',
                contexts: ['video'],
                documentUrlPatterns: ['http://*/*', 'https://*/*']
            });
        } catch (error) {
            console.error('Error creating context menu:', error);
        }
    } else {
        console.warn('Context menus API not available');
    }
}

chrome.runtime.onInstalled.addListener(() => {
    // Delay initialization to ensure APIs are available
    setTimeout(initializeExtension, 100);
});

// Handle context menu clicks (with API availability check)
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        if (info.menuItemId === 'pip-master-context') {
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: () => {
                        // This function runs in the webpage context where document is available
                        try {
                            // Find the clicked video or the best available video
                            const videos = document.querySelectorAll('video');
                            let targetVideo = null;

                            // Try to find a playing video first
                            for (const video of videos) {
                                if (!video.paused && !video.ended && video.videoWidth > 0) {
                                    targetVideo = video;
                                    break;
                                }
                            }

                            // Fallback to the largest video with more detailed selection
                            if (!targetVideo && videos.length > 0) {
                                targetVideo = Array.from(videos)
                                    .filter(video => {
                                        // More comprehensive filtering
                                        return video.videoWidth > 0 && 
                                               video.videoHeight > 0 && 
                                               !video.hidden && 
                                               video.style.display !== 'none' &&
                                               video.offsetParent !== null; // Check if video is visible
                                    })
                                    .sort((a, b) => {
                                        // Sort by priority: playing videos first, then by size
                                        const aPlaying = !a.paused && !a.ended ? 1 : 0;
                                        const bPlaying = !b.paused && !b.ended ? 1 : 0;
                                        
                                        if (aPlaying !== bPlaying) {
                                            return bPlaying - aPlaying; // Playing videos first
                                        }
                                        
                                        const aSize = a.videoWidth * a.videoHeight;
                                        const bSize = b.videoWidth * b.videoHeight;
                                        return bSize - aSize; // Larger videos first
                                    })[0] || null;
                            }

                            if (targetVideo && !document.pictureInPictureElement) {
                                // Store video info for better control
                                const videoInfo = {
                                    src: targetVideo.src || targetVideo.currentSrc,
                                    title: targetVideo.title || document.title,
                                    duration: targetVideo.duration,
                                    currentTime: targetVideo.currentTime,
                                    volume: targetVideo.volume,
                                    playbackRate: targetVideo.playbackRate,
                                    dimensions: {
                                        width: targetVideo.videoWidth,
                                        height: targetVideo.videoHeight
                                    }
                                };
                                
                                console.log('Enabling PiP for video:', videoInfo);
                                
                                // Add event listeners for better control
                                targetVideo.addEventListener('enterpictureinpicture', (event) => {
                                    console.log('Video entered PiP mode:', videoInfo);
                                    // Send message to background script
                                    if (typeof chrome !== 'undefined' && chrome.runtime) {
                                        chrome.runtime.sendMessage({
                                            type: 'pip-video-entered',
                                            videoInfo: videoInfo,
                                            timestamp: Date.now()
                                        }).catch(() => {});
                                    }
                                });
                                
                                targetVideo.addEventListener('leavepictureinpicture', (event) => {
                                    console.log('Video left PiP mode');
                                    if (typeof chrome !== 'undefined' && chrome.runtime) {
                                        chrome.runtime.sendMessage({
                                            type: 'pip-video-left',
                                            timestamp: Date.now()
                                        }).catch(() => {});
                                    }
                                });
                                
                                return targetVideo.requestPictureInPicture();
                            } else if (document.pictureInPictureElement) {
                                return Promise.resolve('Picture-in-Picture is already active');
                            } else {
                                return Promise.resolve('No suitable video found');
                            }
                        } catch (error) {
                            console.error('Error in injected script:', error);
                            return Promise.reject(error);
                        }
                    }
                });
                
                console.log('Context menu PiP result:', results);
            } catch (error) {
                console.error('Error enabling PiP from context menu:', error);
            }
        }
    });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'pip-status-changed') {
        // Update badge or perform other actions when PiP status changes
        const badgeText = message.active ? 'ON' : '';
        const badgeColor = message.active ? '#4CAF50' : '#FF5722';
        
        if (sender.tab) {
            chrome.action.setBadgeText({
                text: badgeText,
                tabId: sender.tab.id
            });
            
            chrome.action.setBadgeBackgroundColor({
                color: badgeColor,
                tabId: sender.tab.id
            });
        }
    }
    
    if (message.type === 'pip-video-entered') {
        // Enhanced video control when PiP is entered
        console.log('Video entered PiP mode with details:', message.videoInfo);
        
        if (sender.tab) {
            // Update badge with video info
            chrome.action.setBadgeText({
                text: 'PiP',
                tabId: sender.tab.id
            });
            
            chrome.action.setBadgeBackgroundColor({
                color: '#2196F3',
                tabId: sender.tab.id
            });
            
            // Store video session info
            chrome.storage.local.set({
                [`pip_session_${sender.tab.id}`]: {
                    videoInfo: message.videoInfo,
                    startTime: message.timestamp,
                    tabId: sender.tab.id,
                    url: sender.tab.url
                }
            });
        }
    }
    
    if (message.type === 'pip-video-left') {
        // Clean up when PiP is exited
        console.log('Video left PiP mode');
        
        if (sender.tab) {
            chrome.action.setBadgeText({
                text: '',
                tabId: sender.tab.id
            });
            
            // Clean up stored session
            chrome.storage.local.remove(`pip_session_${sender.tab.id}`);
        }
    }
    
    if (message.type === 'get-pip-support') {
        // Check if Picture-in-Picture is supported
        sendResponse({
            supported: true // We'll check this in the content script
        });
        return true; // Keep the message channel open for async response
    }
    
    if (message.type === 'get-video-list') {
        // Get list of available videos on the page
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            function: () => {
                const videos = Array.from(document.querySelectorAll('video'));
                return videos.map((video, index) => ({
                    index: index,
                    src: video.src || video.currentSrc,
                    title: video.title || video.getAttribute('aria-label') || `Video ${index + 1}`,
                    duration: video.duration || 0,
                    currentTime: video.currentTime || 0,
                    paused: video.paused,
                    ended: video.ended,
                    volume: video.volume,
                    dimensions: {
                        width: video.videoWidth,
                        height: video.videoHeight
                    },
                    visible: video.offsetParent !== null && !video.hidden
                }));
            }
        }).then(results => {
            sendResponse({ videos: results[0].result });
        }).catch(error => {
            sendResponse({ videos: [], error: error.message });
        });
        return true; // Keep the message channel open for async response
    }
    
    if (message.type === 'control-video') {
        // Control specific video actions
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            function: (action, videoIndex, value) => {
                const videos = document.querySelectorAll('video');
                const targetVideo = videos[videoIndex] || videos[0];
                
                if (!targetVideo) {
                    return { success: false, error: 'Video not found' };
                }
                
                try {
                    switch (action) {
                        case 'play':
                            targetVideo.play();
                            break;
                        case 'pause':
                            targetVideo.pause();
                            break;
                        case 'volume':
                            targetVideo.volume = Math.max(0, Math.min(1, value));
                            break;
                        case 'seek':
                            targetVideo.currentTime = value;
                            break;
                        case 'playbackRate':
                            targetVideo.playbackRate = value;
                            break;
                        case 'fullscreen':
                            if (targetVideo.requestFullscreen) {
                                targetVideo.requestFullscreen();
                            }
                            break;
                        case 'pip-enable':
                            return targetVideo.requestPictureInPicture();
                        case 'pip-disable':
                            if (document.pictureInPictureElement) {
                                return document.exitPictureInPicture();
                            }
                            break;
                        default:
                            return { success: false, error: 'Unknown action' };
                    }
                    return { success: true, action: action, value: value };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            },
            args: [message.action, message.videoIndex, message.value]
        }).then(results => {
            sendResponse(results[0].result);
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep the message channel open for async response
    }
});

// Handle keyboard shortcuts (with API availability check)
if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
        if (command === 'toggle-pip') {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: async () => {
                        // This function runs in the webpage context where document is available
                        try {
                            const videos = document.querySelectorAll('video');
                            
                            if (document.pictureInPictureElement) {
                                // Exit PiP if active
                                await document.exitPictureInPicture();
                                return { action: 'disabled', message: 'PiP disabled' };
                            } else if (videos.length > 0) {
                                // Find best video and enable PiP with enhanced selection
                                let bestVideo = null;
                                
                                // Prefer playing videos
                                for (const video of videos) {
                                    if (!video.paused && !video.ended && video.videoWidth > 0) {
                                        bestVideo = video;
                                        break;
                                    }
                                }
                                
                                // Fallback to largest visible video
                                if (!bestVideo) {
                                    const visibleVideos = Array.from(videos).filter(video => {
                                        return video.videoWidth > 0 && 
                                               video.videoHeight > 0 && 
                                               !video.hidden && 
                                               video.style.display !== 'none' &&
                                               video.offsetParent !== null;
                                    });
                                    
                                    if (visibleVideos.length > 0) {
                                        bestVideo = visibleVideos.reduce((largest, video) => {
                                            const currentSize = video.videoWidth * video.videoHeight;
                                            const largestSize = largest ? largest.videoWidth * largest.videoHeight : 0;
                                            return currentSize > largestSize ? video : largest;
                                        });
                                    }
                                }
                                
                                if (bestVideo) {
                                    // Enhanced video info collection
                                    const videoInfo = {
                                        src: bestVideo.src || bestVideo.currentSrc,
                                        title: bestVideo.title || document.title,
                                        duration: bestVideo.duration,
                                        currentTime: bestVideo.currentTime,
                                        volume: bestVideo.volume,
                                        playbackRate: bestVideo.playbackRate,
                                        dimensions: {
                                            width: bestVideo.videoWidth,
                                            height: bestVideo.videoHeight
                                        },
                                        controls: bestVideo.controls,
                                        autoplay: bestVideo.autoplay,
                                        loop: bestVideo.loop,
                                        muted: bestVideo.muted
                                    };
                                    
                                    // Add enhanced event listeners
                                    bestVideo.addEventListener('enterpictureinpicture', () => {
                                        console.log('Keyboard shortcut: Video entered PiP', videoInfo);
                                    });
                                    
                                    await bestVideo.requestPictureInPicture();
                                    return { 
                                        action: 'enabled', 
                                        message: 'PiP enabled via keyboard',
                                        videoInfo: videoInfo
                                    };
                                } else {
                                    return { action: 'failed', message: 'No suitable video found' };
                                }
                            } else {
                                return { action: 'failed', message: 'No videos found on page' };
                            }
                        } catch (error) {
                            console.error('Error in keyboard shortcut script:', error);
                            return { action: 'error', message: error.message };
                        }
                    }
                });
                
                console.log('Keyboard shortcut PiP result:', results[0].result);
            } catch (error) {
                console.error('Error toggling PiP via keyboard shortcut:', error);
            }
        }
    });
}

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    // Clear any stored state for this tab
    console.log('Tab closed:', tabId);
    
    // Clean up stored PiP session data
    chrome.storage.local.remove(`pip_session_${tabId}`);
    
    // Clear badge for closed tab
    chrome.action.setBadgeText({
        text: '',
        tabId: tabId
    }).catch(() => {
        // Ignore errors for closed tabs
    });
});

// Handle tab updates to refresh video state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Clear any previous PiP session data when page reloads
        if (changeInfo.url || changeInfo.status === 'complete') {
            chrome.storage.local.remove(`pip_session_${tabId}`);
            chrome.action.setBadgeText({
                text: '',
                tabId: tabId
            }).catch(() => {});
        }
    }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('PiP Master extension started');
});