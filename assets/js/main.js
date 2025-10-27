document.addEventListener('DOMContentLoaded', () => {
  // Toggle headers functionality
  document.querySelectorAll('h4').forEach(header => {
    const content = header.nextElementSibling;
    if (content) {
      header.classList.add('toggle-header');
      content.classList.add('toggle-content');
      content.style.display = 'none';

      header.addEventListener('click', () => {
        const isVisible = content.style.display === 'block';
        content.style.display = isVisible ? 'none' : 'block';
        header.classList.toggle('active', !isVisible);
      });
    }
  });

  // Audio player functionality
  initializeAudioPlayer();
});

// Audio Player Implementation
function initializeAudioPlayer() {
  const audio = document.getElementById('article-audio');
  if (!audio) return; // Exit if no audio element on page

  const playPauseBtn = document.getElementById('play-pause-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');
  const progressBar = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');
  const muteBtn = document.getElementById('mute-btn');
  const volumeIcon = document.getElementById('volume-icon');
  const muteIcon = document.getElementById('mute-icon');
  const volumeSlider = document.getElementById('volume-slider');
  const speedControl = document.getElementById('speed-control');

  // Get unique storage key based on audio source
  const storageKey = `audio-position-${window.location.pathname}`;
  let isSeeking = false;

  // Format time helper (converts seconds to mm:ss)
  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Load saved position and settings
  function loadSavedState() {
    try {
      const savedPosition = localStorage.getItem(storageKey);
      if (savedPosition && !isNaN(savedPosition)) {
        audio.currentTime = parseFloat(savedPosition);
      }

      const savedVolume = localStorage.getItem('audio-volume');
      if (savedVolume && !isNaN(savedVolume)) {
        audio.volume = parseFloat(savedVolume);
        volumeSlider.value = parseFloat(savedVolume) * 100;
      }

      const savedSpeed = localStorage.getItem('audio-speed');
      if (savedSpeed && !isNaN(savedSpeed)) {
        audio.playbackRate = parseFloat(savedSpeed);
        speedControl.value = savedSpeed;
      }

      const savedMuted = localStorage.getItem('audio-muted');
      if (savedMuted === 'true') {
        audio.muted = true;
        updateMuteIcon(true);
      }
    } catch (e) {
      console.error('Error loading audio state:', e);
    }
  }

  // Save position periodically
  function savePosition() {
    try {
      localStorage.setItem(storageKey, audio.currentTime.toString());
    } catch (e) {
      console.error('Error saving audio position:', e);
    }
  }

  // Update play/pause icons
  function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
    }
  }

  // Update mute icons
  function updateMuteIcon(isMuted) {
    if (isMuted) {
      volumeIcon.style.display = 'none';
      muteIcon.style.display = 'block';
    } else {
      volumeIcon.style.display = 'block';
      muteIcon.style.display = 'none';
    }
  }

  // Update progress bar and time display
  function updateProgress() {
    if (isSeeking) return;

    const currentTime = audio.currentTime;
    const duration = audio.duration;

    currentTimeEl.textContent = formatTime(currentTime);

    if (isFinite(duration)) {
      const progress = (currentTime / duration) * 100;
      progressBar.value = progress;
      progressFill.style.width = `${progress}%`;
    }
  }

  // Play/Pause toggle
  function togglePlayPause() {
    if (audio.paused) {
      audio.play().catch(err => {
        console.error('Error playing audio:', err);
      });
    } else {
      audio.pause();
    }
  }

  // Seek to position
  function seek(e) {
    const duration = audio.duration;
    if (!isFinite(duration)) return;

    const percent = parseFloat(e.target.value);
    const time = (percent / 100) * duration;
    audio.currentTime = time;
    progressFill.style.width = `${percent}%`;
  }

  // Update volume
  function updateVolume(value) {
    const volume = value / 100;
    audio.volume = volume;

    try {
      localStorage.setItem('audio-volume', volume.toString());
    } catch (e) {
      console.error('Error saving volume:', e);
    }

    // Unmute if volume is changed
    if (audio.muted && volume > 0) {
      audio.muted = false;
      updateMuteIcon(false);
      localStorage.setItem('audio-muted', 'false');
    }
  }

  // Toggle mute
  function toggleMute() {
    audio.muted = !audio.muted;
    updateMuteIcon(audio.muted);

    try {
      localStorage.setItem('audio-muted', audio.muted.toString());
    } catch (e) {
      console.error('Error saving mute state:', e);
    }
  }

  // Change playback speed
  function changeSpeed(speed) {
    audio.playbackRate = parseFloat(speed);

    try {
      localStorage.setItem('audio-speed', speed);
    } catch (e) {
      console.error('Error saving speed:', e);
    }
  }

  // Event Listeners
  playPauseBtn.addEventListener('click', togglePlayPause);

  audio.addEventListener('play', () => {
    updatePlayPauseIcon(true);
  });

  audio.addEventListener('pause', () => {
    updatePlayPauseIcon(false);
    savePosition();
  });

  audio.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(audio.duration);
    loadSavedState();
    updateProgress();
  });

  audio.addEventListener('timeupdate', () => {
    updateProgress();

    // Auto-save position every 5 seconds
    if (Math.floor(audio.currentTime) % 5 === 0) {
      savePosition();
    }
  });

  audio.addEventListener('ended', () => {
    updatePlayPauseIcon(false);
    progressBar.value = 0;
    progressFill.style.width = '0%';
    try {
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Error removing saved position:', e);
    }
  });

  progressBar.addEventListener('input', (e) => {
    isSeeking = true;
    const percent = parseFloat(e.target.value);
    progressFill.style.width = `${percent}%`;

    // Update time display during seeking
    const duration = audio.duration;
    if (isFinite(duration)) {
      const time = (percent / 100) * duration;
      currentTimeEl.textContent = formatTime(time);
    }
  });

  progressBar.addEventListener('change', (e) => {
    seek(e);
    isSeeking = false;
  });

  muteBtn.addEventListener('click', toggleMute);

  volumeSlider.addEventListener('input', (e) => {
    updateVolume(parseFloat(e.target.value));
  });

  speedControl.addEventListener('change', (e) => {
    changeSpeed(e.target.value);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Only respond if we're not in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    switch(e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
        break;
      case 'm':
        e.preventDefault();
        toggleMute();
        break;
      case 'ArrowUp':
        e.preventDefault();
        const newVolumeUp = Math.min(1, audio.volume + 0.1);
        audio.volume = newVolumeUp;
        volumeSlider.value = newVolumeUp * 100;
        updateVolume(newVolumeUp * 100);
        break;
      case 'ArrowDown':
        e.preventDefault();
        const newVolumeDown = Math.max(0, audio.volume - 0.1);
        audio.volume = newVolumeDown;
        volumeSlider.value = newVolumeDown * 100;
        updateVolume(newVolumeDown * 100);
        break;
    }
  });

  // Save position before page unload
  window.addEventListener('beforeunload', () => {
    if (!audio.paused) {
      savePosition();
    }
  });

  // Initialize on page load
  loadSavedState();
}

// Image Lightbox functionality
function initializeImageLightbox() {
  const lightbox = document.getElementById('image-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.querySelector('.lightbox-caption');
  const closeBtn = document.querySelector('.lightbox-close');

  if (!lightbox) return; // Exit if lightbox doesn't exist

  // Find all images in article content (excluding audio player icons)
  const articleImages = document.querySelectorAll('article img:not(.audio-controls img)');

  // Add click event to each image
  articleImages.forEach(img => {
    // Add pointer cursor to indicate clickable
    img.style.cursor = 'pointer';

    img.addEventListener('click', function() {
      lightbox.style.display = 'block';
      lightboxImg.src = this.src;

      // Set caption from alt text or empty
      if (this.alt) {
        lightboxCaption.textContent = this.alt;
        lightboxCaption.style.display = 'block';
      } else {
        lightboxCaption.style.display = 'none';
      }

      // Prevent body scroll when lightbox is open
      document.body.style.overflow = 'hidden';
    });
  });

  // Close lightbox when clicking the X button
  closeBtn.addEventListener('click', function() {
    lightbox.style.display = 'none';
    document.body.style.overflow = 'auto';
  });

  // Close lightbox when clicking outside the image
  lightbox.addEventListener('click', function(e) {
    if (e.target === lightbox || e.target === closeBtn) {
      lightbox.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  });

  // Close lightbox with Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && lightbox.style.display === 'block') {
      lightbox.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  });
}

// Initialize image lightbox on page load
document.addEventListener('DOMContentLoaded', function() {
  initializeImageLightbox();
});