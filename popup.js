document.addEventListener('DOMContentLoaded', async () => {
    const videoCountElement = document.getElementById('videoCount');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const enablePipBtn = document.getElementById('enablePip');
    const disablePipBtn = document.getElementById('disablePip');
    const refreshBtn = document.getElementById('refreshVideos');

    let currentTab;
    let videoCount = 0;
    let pipActive = false;

    // Get current active tab
    async function getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }

    // Update UI status
    function updateStatus(count, active = false) {
        videoCount = count;
        pipActive = active;
        
        videoCountElement.textContent = count;
        
        if (count === 0) {
            statusIndicator.className = 'status-indicator status-inactive';
            statusText.textContent = 'No videos found on this page';
            enablePipBtn.disabled = true;
        } else {
            statusIndicator.className = 'status-indicator status-active';
            statusText.textContent = `${count} video${count > 1 ? 's' : ''} ready for PiP`;
            enablePipBtn.disabled = active;
        }
        
        disablePipBtn.disabled = !active;
        
        if (active) {
            enablePipBtn.innerHTML = '✅ Picture-in-Picture Active';
            statusText.textContent = 'Picture-in-Picture mode is active';
        } else {
            enablePipBtn.innerHTML = '🎬 Enable Picture-in-Picture';
        }
    }

    // Scan for videos on the page
    async function scanForVideos() {
        try {
            currentTab = await getCurrentTab();
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: () => {
                    const videos = document.querySelectorAll('video');
                    return {
                        count: videos.length,
                        hasPip: document.pictureInPictureElement !== null
                    };
                }
            });

            if (results && results[0]) {
                const { count, hasPip } = results[0].result;
                updateStatus(count, hasPip);
            }
        } catch (error) {
            console.error('Error scanning for videos:', error);
            updateStatus(0, false);
            statusText.textContent = 'Unable to scan this page';
        }
    }

    // Enable Picture-in-Picture
    async function enablePictureInPicture() {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: async () => {
                    const videos = document.querySelectorAll('video');
                    let videoToPlay = null;

                    // Find the best video to use (playing, or largest, or first)
                    for (const video of videos) {
                        if (!video.paused && !video.ended) {
                            videoToPlay = video;
                            break;
                        }
                    }

                    if (!videoToPlay && videos.length > 0) {
                        // Find the largest video
                        videoToPlay = Array.from(videos).reduce((largest, video) => {
                            const currentSize = video.videoWidth * video.videoHeight;
                            const largestSize = largest.videoWidth * largest.videoHeight;
                            return currentSize > largestSize ? video : largest;
                        });
                    }

                    if (videoToPlay && !document.pictureInPictureElement) {
                        try {
                            await videoToPlay.requestPictureInPicture();
                            return { success: true, message: 'Picture-in-Picture enabled!' };
                        } catch (error) {
                            return { success: false, message: error.message };
                        }
                    } else if (document.pictureInPictureElement) {
                        return { success: false, message: 'Picture-in-Picture is already active' };
                    } else {
                        return { success: false, message: 'No suitable video found' };
                    }
                }
            });

            // Refresh status after attempting to enable PiP
            setTimeout(scanForVideos, 500);
        } catch (error) {
            console.error('Error enabling PiP:', error);
        }
    }

    // Disable Picture-in-Picture
    async function disablePictureInPicture() {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: async () => {
                    if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                        return { success: true };
                    }
                    return { success: false };
                }
            });

            // Refresh status after disabling PiP
            setTimeout(scanForVideos, 500);
        } catch (error) {
            console.error('Error disabling PiP:', error);
        }
    }

    // Event listeners
    enablePipBtn.addEventListener('click', enablePictureInPicture);
    disablePipBtn.addEventListener('click', disablePictureInPicture);
    refreshBtn.addEventListener('click', scanForVideos);

    // Initial scan
    await scanForVideos();

    // Auto-refresh every 2 seconds
    setInterval(scanForVideos, 2000);
});