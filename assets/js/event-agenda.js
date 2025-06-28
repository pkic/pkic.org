document.addEventListener('DOMContentLoaded', function() {
    // Initialize location filtering
    initializeLocationFiltering();
    
    // Initialize fullscreen functionality
    initializeFullscreen();
    
    // Set up grid responsiveness
    setupGridResponsiveness();
    
    // Initialize touch navigation
    enableTouchNavigation();
    
    // Initialize session preview overflow detection
    initializeSessionPreviews();
});

// YouTube embed handling
document.addEventListener('DOMContentLoaded', function() {
    // Handle modal show events to load YouTube videos
    const sessionModals = document.querySelectorAll('.session-modal');
    
    sessionModals.forEach(modal => {
        modal.addEventListener('shown.bs.modal', function() {
            const iframe = this.querySelector('.youtube-iframe');
            const placeholder = this.querySelector('.youtube-loading-placeholder');
            
            if (iframe && placeholder) {
                // Show iframe and start loading
                iframe.classList.remove('d-none');
                
                // Handle iframe load event
                iframe.addEventListener('load', function() {
                    setTimeout(() => {
                        placeholder.classList.add('fade-out');
                        iframe.classList.add('loaded');
                    }, 500); // Small delay for smoother transition
                });
                
                // Fallback timeout in case load event doesn't fire
                setTimeout(() => {
                    if (!iframe.classList.contains('loaded')) {
                        placeholder.classList.add('fade-out');
                        iframe.classList.add('loaded');
                    }
                }, 3000);
            }
        });
        
        // Reset video state when modal is hidden
        modal.addEventListener('hidden.bs.modal', function() {
            const iframe = this.querySelector('.youtube-iframe');
            const placeholder = this.querySelector('.youtube-loading-placeholder');
            
            if (iframe && placeholder) {
                // Reset states
                placeholder.classList.remove('fade-out');
                iframe.classList.remove('loaded');
                iframe.classList.add('d-none');
                
                // Reset iframe src to stop video
                const src = iframe.src;
                iframe.src = '';
                iframe.src = src;
            }
        });
    });
});

function initializeLocationFiltering() {
    // Handle individual location buttons
    document.querySelectorAll('.location-filter-btn').forEach(button => {
        button.addEventListener('click', function() {
            const location = this.getAttribute('data-location');
            const tabPane = this.closest('.tab-pane');
            
            // Toggle active state for multiple selection
            this.classList.toggle('active');
            
            filterByMultipleLocations(tabPane);
        });
    });
    
    // Handle "All Locations" button
    document.querySelectorAll('#select-all-locations').forEach(button => {
        button.addEventListener('click', function() {
            const tabPane = this.closest('.tab-pane');
            const locationBtns = tabPane.querySelectorAll('.location-filter-btn');
            
            // Select all locations
            locationBtns.forEach(btn => btn.classList.add('active'));
            filterByMultipleLocations(tabPane);
        });
    });
    
    // Initialize all locations as selected by default - run after a short delay to ensure DOM is ready
    setTimeout(() => {
        document.querySelectorAll('.desktop-agenda').forEach(desktopAgenda => {
            const tabPane = desktopAgenda.closest('.tab-pane');
            const locationBtns = tabPane.querySelectorAll('.location-filter-btn');
            
            // Only initialize if no buttons are already active
            const activeButtons = tabPane.querySelectorAll('.location-filter-btn.active');
            if (activeButtons.length === 0) {
                locationBtns.forEach(btn => btn.classList.add('active'));
                filterByMultipleLocations(tabPane);
            }
        });
    }, 100);
}

function filterByMultipleLocations(tabPane) {
    const grid = tabPane.querySelector('.agenda-grid');
    const sessions = grid.querySelectorAll('.agenda-session');
    const breaks = grid.querySelectorAll('.agenda-break');
    const activeButtons = tabPane.querySelectorAll('.location-filter-btn.active');
    
    // Get selected location IDs
    const selectedLocations = Array.from(activeButtons).map(btn => btn.getAttribute('data-location'));
    
    if (selectedLocations.length === 0) {
        // Hide all sessions if nothing selected
        sessions.forEach(session => {
            session.style.display = 'none';
            session.classList.add('hidden');
        });
        
        // Update grid for single column
        updateGridColumns(grid, 1);
        breaks.forEach(breakEl => {
            breakEl.style.gridColumn = '2';
        });
    } else {
        // Show sessions for selected locations
        sessions.forEach(session => {
            const sessionLocation = session.getAttribute('data-location');
            if (selectedLocations.includes(sessionLocation)) {
                session.style.display = '';
                session.classList.remove('hidden');
            } else {
                session.style.display = 'none';
                session.classList.add('hidden');
            }
        });
        
        // Update grid based on number of selected locations
        const visibleLocationCount = selectedLocations.length;
        updateGridColumns(grid, visibleLocationCount);
        
        // Breaks span visible columns
        breaks.forEach(breakEl => {
            if (visibleLocationCount === 1) {
                breakEl.style.gridColumn = '2';
            } else {
                breakEl.style.gridColumn = '2 / -1';
            }
        });
    }
}

function updateGridColumns(grid, locationCount) {
    if (locationCount === 1) {
        grid.style.gridTemplateColumns = '100px 1fr';
    } else if (locationCount <= 5) {
        // Use fr units to fill available space
        grid.style.gridTemplateColumns = `100px repeat(${locationCount}, 1fr)`;
    } else {
        // For more than 5 locations, use fixed width to enable scrolling
        grid.style.gridTemplateColumns = `100px repeat(${locationCount}, 160px)`;
        grid.style.minWidth = `calc(100px + ${locationCount * 160}px + ${locationCount * 0.5}rem)`;
    }
    
    // Update CSS custom property
    grid.style.setProperty('--location-count', locationCount);
    grid.setAttribute('data-locations', locationCount.toString());
}

function setupGridResponsiveness() {
    function handleResize() {
        document.querySelectorAll('.agenda-grid').forEach(grid => {
            const visibleSessions = Array.from(grid.querySelectorAll('.agenda-session'))
                .filter(session => session.style.display !== 'none');
            
            const locationCount = new Set(visibleSessions.map(s => s.getAttribute('data-location'))).size;
            updateGridColumns(grid, locationCount);
        });
    }
    
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call
}

function initializeFullscreen() {
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (!fullscreenBtn) return;
    
    fullscreenBtn.addEventListener('click', function() {
        const container = document.getElementById('agenda-container');
        const icon = this.querySelector('i');
        
        if (container.classList.contains('agenda-fullscreen')) {
            // Exit fullscreen
            container.classList.remove('agenda-fullscreen');
            document.body.style.overflow = '';
            icon.className = 'fas fa-expand';
            this.title = 'Enter Fullscreen';
        } else {
            // Enter fullscreen
            container.classList.add('agenda-fullscreen');
            document.body.style.overflow = 'hidden';
            icon.className = 'fas fa-compress';
            this.title = 'Exit Fullscreen';
        }
    });
    
    // ESC key to exit fullscreen
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const container = document.getElementById('agenda-container');
            if (container && container.classList.contains('agenda-fullscreen')) {
                const icon = fullscreenBtn.querySelector('i');
                container.classList.remove('agenda-fullscreen');
                document.body.style.overflow = '';
                icon.className = 'fas fa-expand';
                fullscreenBtn.title = 'Enter Fullscreen';
            }
        }
    });
}

function enableTouchNavigation() {
    // Touch navigation for horizontal scrolling on grid
    let touchStartX = 0;
    let touchEndX = 0;

    document.querySelectorAll('.agenda-grid-container').forEach(container => {
        container.addEventListener('touchstart', function(e) {
            touchStartX = e.changedTouches[0].screenX;
        });

        container.addEventListener('touchend', function(e) {
            touchEndX = e.changedTouches[0].screenX;
            
            const swipeThreshold = 50;
            const swipeDistance = touchEndX - touchStartX;
            
            if (Math.abs(swipeDistance) > swipeThreshold) {
                // Smooth scroll horizontally
                const scrollAmount = swipeDistance > 0 ? -200 : 200;
                container.scrollBy({
                    left: scrollAmount,
                    behavior: 'smooth'
                });
            }
        });
    });
}

function initializeSessionPreviews() {
    // Check if session previews need gradient overlay
    document.querySelectorAll('.session-preview-gradient').forEach(preview => {
        const lineHeight = parseInt(window.getComputedStyle(preview).lineHeight);
        const maxHeight = lineHeight * 2.3; // approximately 2.3 lines
        
        if (preview.scrollHeight > maxHeight) {
            preview.classList.add('has-overflow');
            preview.style.maxHeight = maxHeight + 'px';
        }
    });
}