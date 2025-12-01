document.addEventListener('DOMContentLoaded', function () {
    // Initialize location filtering
    initializeLocationFiltering();

    // Initialize fullscreen functionality
    initializeFullscreen();

    // Set up grid responsiveness
    setupGridResponsiveness();

    // Initialize touch navigation
    enableTouchNavigation();

    // Global Expand All button logic
    initializeGlobalExpandAll();

    // Initialize overflow navigation
    initializeOverflowNavigation();

    // Unload YouTube videos on modal close
    unloadYoutubeOnModalClose();

    // Break overlays removed; using inline break cards again
});

// YouTube embed handling
document.addEventListener('DOMContentLoaded', function () {
    // Handle modal show events to load YouTube videos
    const sessionModals = document.querySelectorAll('.session-modal');

    sessionModals.forEach(modal => {
        modal.addEventListener('shown.bs.modal', function () {
            const iframe = this.querySelector('.youtube-iframe');
            const placeholder = this.querySelector('.youtube-loading-placeholder');

            if (iframe && placeholder) {
                // Show iframe and start loading
                iframe.classList.remove('d-none');

                // Handle iframe load event
                iframe.addEventListener('load', function () {
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
        modal.addEventListener('hidden.bs.modal', function () {
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

function unloadYoutubeOnModalClose() {
    // Unload YouTube iframe when modal is closed
    const sessionModals = document.querySelectorAll('.session-modal');
    sessionModals.forEach(modal => {
        modal.addEventListener('hidden.bs.modal', function () {
            const iframe = modal.querySelector('iframe[src*="youtube"]');
            if (iframe) {
                iframe.src = iframe.src;
            }
        });
    });
}

function initializeLocationFiltering() {
    // Handle individual location buttons
    document.querySelectorAll('.location-filter-btn').forEach(button => {
        button.addEventListener('click', function () {
            const location = this.getAttribute('data-location');
            const tabPane = this.closest('.tab-pane');

            // Toggle active state for multiple selection
            this.classList.toggle('active');

            filterByMultipleLocations(tabPane);
        });
    });

    // Handle "All Locations" button
    document.querySelectorAll('#select-all-locations').forEach(button => {
        button.addEventListener('click', function () {
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
        // Update overflow navigation after filtering and recalc break widths
        setTimeout(() => {
            updateOverflowNavigation(tabPane);
            recalcBreakWidths(tabPane.querySelector('.agenda-grid-container'));
        }, 120);
    }
}

function updateGridColumns(grid, locationCount) {
    if (locationCount === 1) {
        grid.style.gridTemplateColumns = '100px 1fr';
    } else if (locationCount <= 3) {
        // Use fr units to fill available space for small counts
        grid.style.gridTemplateColumns = `100px repeat(${locationCount}, 1fr)`;
        grid.style.minWidth = '';
    } else {
        // For more than 3 locations, use fixed width to enable scrolling
        grid.style.gridTemplateColumns = `100px repeat(${locationCount}, 320px)`;
        grid.style.minWidth = `calc(100px + ${locationCount * 320}px + ${locationCount * 0.5}rem)`;
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

// --- Break card sizing (width should match visible container minus time column) ---
function recalcBreakWidths(container) {
    if (!container) return;
    const timeCol = container.querySelector('.agenda-time');
    const timeWidth = timeCol ? timeCol.offsetWidth : 100;
    const visibleWidth = container.clientWidth - timeWidth;
    container.style.setProperty('--agenda-break-width', visibleWidth + 'px');
    container.style.setProperty('--agenda-time-width', timeWidth + 'px');
}

function initializeBreakSizing() {
    document.querySelectorAll('.agenda-grid-container').forEach(container => {
        recalcBreakWidths(container);
        // Recalculate on horizontal scroll (in case vertical scrollbar appears/disappears)
        container.addEventListener('scroll', () => {
            // Throttle with rAF
            if (container.__breakWidthTicking) return;
            container.__breakWidthTicking = true;
            requestAnimationFrame(() => {
                recalcBreakWidths(container);
                container.__breakWidthTicking = false;
            });
        });
    });

    // Global resize observer
    const ro = new ResizeObserver(entries => {
        entries.forEach(entry => recalcBreakWidths(entry.target));
    });
    document.querySelectorAll('.agenda-grid-container').forEach(c => ro.observe(c));

    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            document.querySelectorAll('.agenda-grid-container').forEach(recalcBreakWidths);
        }, 200);
    });
}

document.addEventListener('DOMContentLoaded', initializeBreakSizing);

function initializeFullscreen() {
    const fullscreenBtns = document.querySelectorAll('#fullscreen-btn, #fullscreen-btn-mobile');
    if (fullscreenBtns.length === 0) return;

    fullscreenBtns.forEach(fullscreenBtn => {
        fullscreenBtn.addEventListener('click', function () {
            const container = document.getElementById('agenda-container');
            const icon = this.querySelector('svg');

            if (container.classList.contains('agenda-fullscreen')) {
                // Exit fullscreen
                container.classList.remove('agenda-fullscreen');
                document.body.style.overflow = '';
                this.title = 'Toggle Fullscreen';
                setTimeout(() => recalcBreakWidths(container.querySelector('.agenda-grid-container')), 100);
            } else {
                // Enter fullscreen
                container.classList.add('agenda-fullscreen');
                document.body.style.overflow = 'hidden';
                this.title = 'Exit Fullscreen';
                setTimeout(() => recalcBreakWidths(container.querySelector('.agenda-grid-container')), 150);
            }
        });
    });

    // ESC key to exit fullscreen
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            const container = document.getElementById('agenda-container');
            if (container && container.classList.contains('agenda-fullscreen')) {
                container.classList.remove('agenda-fullscreen');
                document.body.style.overflow = '';
                fullscreenBtns.forEach(btn => {
                    btn.title = 'Toggle Fullscreen';
                });
            }
        }
    });
}

function enableTouchNavigation() {
    // Touch navigation for horizontal scrolling on grid
    let touchStartX = 0;
    let touchEndX = 0;

    document.querySelectorAll('.agenda-grid-container').forEach(container => {
        container.addEventListener('touchstart', function (e) {
            touchStartX = e.changedTouches[0].screenX;
        });

        container.addEventListener('touchend', function (e) {
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

function initializeGlobalExpandAll() {
    const expandBtns = document.querySelectorAll('#expand-all-btn, #expand-all-btn-mobile');
    if (expandBtns.length === 0) return;
    
    let expanded = false;
    
    expandBtns.forEach(expandBtn => {
        expandBtn.addEventListener('click', function () {
            const cards = document.querySelectorAll('.session-content');
            expanded = !expanded;
            
            cards.forEach(function (card) {
                if (expanded) {
                    card.classList.add('expanded');
                } else {
                    card.classList.remove('expanded');
                }
            });
            
            // Update all buttons
            expandBtns.forEach(btn => {
                btn.title = expanded ? 'Collapse All' : 'Expand All';
                btn.classList.toggle('btn-primary', expanded);
                btn.classList.toggle('btn-outline-secondary', !expanded);
            });
        });
    });
}

function initializeOverflowNavigation() {
    document.querySelectorAll('.desktop-agenda').forEach(desktopAgenda => {
        const container = desktopAgenda.querySelector('.agenda-grid-container');
        if (!container) return;

        // Check if arrows already exist
        if (desktopAgenda.querySelector('.scroll-arrow')) return;

        // Add navigation arrows to the desktop-agenda wrapper (not the scrolling container)
        const leftArrow = document.createElement('div');
        leftArrow.className = 'scroll-arrow scroll-left disabled';
        leftArrow.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
        `;

        const rightArrow = document.createElement('div');
        rightArrow.className = 'scroll-arrow scroll-right';
        rightArrow.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
            </svg>
        `;

        desktopAgenda.appendChild(leftArrow);
        desktopAgenda.appendChild(rightArrow);

        // Scroll functionality
        const scrollAmount = 340; // Slightly more than one column width

        leftArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.scrollBy({
                left: -scrollAmount,
                behavior: 'smooth'
            });
        });

        rightArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.scrollBy({
                left: scrollAmount,
                behavior: 'smooth'
            });
        });

        // Update arrow states and fade indicators
        function updateScrollIndicators() {
            const scrollLeft = Math.round(container.scrollLeft);
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;
            const maxScroll = scrollWidth - clientWidth;
            const hasScroll = maxScroll > 5; // Small tolerance for browser differences

            // Hide arrows completely if no scrolling is needed
            leftArrow.style.display = hasScroll ? 'flex' : 'none';
            rightArrow.style.display = hasScroll ? 'flex' : 'none';

            if (hasScroll) {
                // Update arrow states with some tolerance
                leftArrow.classList.toggle('disabled', scrollLeft <= 1);
                rightArrow.classList.toggle('disabled', scrollLeft >= maxScroll - 1);

                // Update fade indicators on the desktop-agenda wrapper
                desktopAgenda.classList.toggle('show-left-fade', scrollLeft > 10);
                desktopAgenda.classList.toggle('show-right-fade', scrollLeft < maxScroll - 10);
            } else {
                // Remove fade indicators if no scroll
                desktopAgenda.classList.remove('show-left-fade', 'show-right-fade');
            }
        }

        // Listen for scroll events with debouncing
        let scrollTimeout;
        container.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(updateScrollIndicators, 50);
        });
        
        // Initial update after a delay to ensure layout is complete
        setTimeout(updateScrollIndicators, 200);

        // Update on window resize
        window.addEventListener('resize', () => {
            setTimeout(updateScrollIndicators, 200);
        });

        // Keyboard navigation
        container.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && !leftArrow.classList.contains('disabled')) {
                e.preventDefault();
                leftArrow.click();
            } else if (e.key === 'ArrowRight' && !rightArrow.classList.contains('disabled')) {
                e.preventDefault();
                rightArrow.click();
            }
        });

        // Make container focusable for keyboard navigation
        container.setAttribute('tabindex', '0');
        
        // Store update function on container for external access
        container.updateScrollIndicators = updateScrollIndicators;
    });
}

// (Removed overlay handling functions)

function updateOverflowNavigation(tabPane) {
    const desktopAgenda = tabPane.querySelector('.desktop-agenda');
    const container = tabPane.querySelector('.agenda-grid-container');
    if (!container || !desktopAgenda) return;

    // Use the stored update function if available
    if (container.updateScrollIndicators) {
        setTimeout(() => {
            container.updateScrollIndicators();
        }, 100);
        return;
    }

    // Fallback for older implementation
    const leftArrow = desktopAgenda.querySelector('.scroll-left');
    const rightArrow = desktopAgenda.querySelector('.scroll-right');
    
    if (!leftArrow || !rightArrow) return;

    // Force recalculation of scroll indicators
    setTimeout(() => {
        const scrollLeft = Math.round(container.scrollLeft);
        const scrollWidth = container.scrollWidth;
        const clientWidth = container.clientWidth;
        const maxScroll = scrollWidth - clientWidth;

        // Update arrow states
        leftArrow.classList.toggle('disabled', scrollLeft <= 1);
        rightArrow.classList.toggle('disabled', scrollLeft >= maxScroll - 1 || maxScroll <= 0);

        // Update fade indicators on desktop-agenda wrapper
        desktopAgenda.classList.toggle('show-left-fade', scrollLeft > 10);
        desktopAgenda.classList.toggle('show-right-fade', scrollLeft < maxScroll - 10 && maxScroll > 10);
    }, 150);
}