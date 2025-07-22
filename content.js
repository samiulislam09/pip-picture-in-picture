// Content script for PiP Master extension
(function() {
    'use strict';

    let pipButton = null;
    let currentVideo = null;
    let observer = null;
    let cssInjected = false;

    // Inject CSS styles
    function injectCSS() {
        if (cssInjected) return;
        
        const css = `
            #pip-master-button {
                position: absolute;
                z-index: 999999;
                width: 50px;
                height: 50px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 50%;
                display: none;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
                backdrop-filter: blur(10px);
                border: 2px solid rgba(255, 255, 255, 0.2);
                user-select: none;
            }

            #pip-master-button:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 25px rgba(102, 126, 234, 0.6);
            }

            #pip-master-button .pip-icon {
                font-size: 20px;
                line-height: 1;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }

            #pip-master-button .pip-tooltip {
                position: absolute;
                top: -45px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 8px 12px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 500;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            #pip-master-button .pip-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 5px solid transparent;
                border-top-color: rgba(0, 0, 0, 0.9);
            }

            #pip-master-button:hover .pip-tooltip {
                opacity: 1;
            }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        cssInjected = true;
    }

    // Create floating PiP button
    function createPipButton() {
        if (pipButton) return;

        pipButton = document.createElement('div');
        pipButton.id = 'pip-master-button';
        pipButton.innerHTML = `
            <div class="pip-icon">📺</div>
            <span class="pip-tooltip">Picture-in-Picture</span>
        `;
        
        pipButton.addEventListener('click', handlePipButtonClick);
        document.body.appendChild(pipButton);
    }

    // Handle PiP button click
    async function handlePipButtonClick(e) {
        e.preventDefault();
        e.stopPropagation();

        if (currentVideo) {
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    await currentVideo.requestPictureInPicture();
                }
            } catch (error) {
                console.error('PiP error:', error);
            }
        }
    }

    // Position button near video
    function positionButton(video) {
        if (!pipButton || !video) return;

        const rect = video.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        // Position button at top-right corner of video
        pipButton.style.left = (rect.right - 60 + scrollLeft) + 'px';
        pipButton.style.top = (rect.top + 10 + scrollTop) + 'px';
        pipButton.style.display = 'block';
    }

    // Hide button
    function hideButton() {
        if (pipButton) {
            pipButton.style.display = 'none';
        }
    }

    // Find best video element
    function findBestVideo() {
        const videos = document.querySelectorAll('video');
        if (videos.length === 0) return null;

        // Prefer playing videos
        for (const video of videos) {
            if (!video.paused && !video.ended && video.videoWidth > 0) {
                return video;
            }
        }

        // Fallback to largest video
        return Array.from(videos)
            .filter(video => video.videoWidth > 0)
            .reduce((largest, video) => {
                const currentSize = video.videoWidth * video.videoHeight;
                const largestSize = largest ? largest.videoWidth * largest.videoHeight : 0;
                return currentSize > largestSize ? video : largest;
            }, null);
    }

    // Handle video hover
    function handleVideoHover(e) {
        const video = e.target;
        if (video.tagName !== 'VIDEO') return;

        currentVideo = video;
        createPipButton();
        positionButton(video);
    }

    // Handle video leave
    function handleVideoLeave(e) {
        if (e.target.tagName !== 'VIDEO') return;
        
        // Small delay to prevent flickering when moving between video elements
        setTimeout(() => {
            const hoveredElement = document.elementFromPoint(e.clientX, e.clientY);
            if (!hoveredElement || (hoveredElement.tagName !== 'VIDEO' && !pipButton.contains(hoveredElement))) {
                hideButton();
                currentVideo = null;
            }
        }, 100);
    }

    // Set up video monitoring
    function setupVideoMonitoring() {
        // Clean up existing listeners
        if (observer) {
            observer.disconnect();
        }

        // Add hover listeners to existing videos
        document.querySelectorAll('video').forEach(video => {
            video.addEventListener('mouseenter', handleVideoHover);
            video.addEventListener('mouseleave', handleVideoLeave);
        });

        // Monitor for new videos
        observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        const videos = node.tagName === 'VIDEO' ? [node] : node.querySelectorAll('video');
                        videos.forEach(video => {
                            video.addEventListener('mouseenter', handleVideoHover);
                            video.addEventListener('mouseleave', handleVideoLeave);
                        });
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Handle PiP events
    function setupPipEvents() {
        document.addEventListener('enterpictureinpicture', () => {
            if (pipButton) {
                pipButton.querySelector('.pip-icon').textContent = '⏹️';
                pipButton.querySelector('.pip-tooltip').textContent = 'Exit Picture-in-Picture';
            }
            // Notify background script
            chrome.runtime.sendMessage({
                type: 'pip-status-changed',
                active: true
            }).catch(() => {
                // Ignore errors if background script is not available
            });
        });

        document.addEventListener('leavepictureinpicture', () => {
            if (pipButton) {
                pipButton.querySelector('.pip-icon').textContent = '📺';
                pipButton.querySelector('.pip-tooltip').textContent = 'Picture-in-Picture';
            }
            // Notify background script
            chrome.runtime.sendMessage({
                type: 'pip-status-changed',
                active: false
            }).catch(() => {
                // Ignore errors if background script is not available
            });
        });
    }

    // Initialize
    function init() {
        // Only run on pages that might have videos
        if (document.body) {
            injectCSS();
            setupVideoMonitoring();
            setupPipEvents();
        }
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (observer) {
            observer.disconnect();
        }
        if (pipButton) {
            pipButton.remove();
        }
    });
})();