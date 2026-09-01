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

    // Day tabs and the session dialogs
    initializeDayTabs();
    initializeSessionDialogs();

    // Keep nested actions from triggering their session card.
    initializeSessionActionPropagation();

    // Break overlays removed; using inline break cards again
});

/**
 * Session dialogs.
 *
 * `<dialog>` supplies the top layer, the backdrop, the focus trap and
 * Escape-to-close, so what is left is opening one from a card, closing it from
 * either of its buttons or a backdrop click, locking the page behind it, and
 * reloading the embed so a closed recording stops playing.
 */
function initializeSessionDialogs() {
    document.querySelectorAll('[data-agenda-open-session]').forEach(trigger => {
        trigger.addEventListener('click', () => {
            const dialog = document.getElementById(trigger.getAttribute('data-agenda-open-session'));
            if (!dialog || typeof dialog.showModal !== 'function' || dialog.open) return;
            dialog.showModal();
            document.body.classList.add('agenda-modal-open');
        });
    });

    document.querySelectorAll('.session-modal').forEach(dialog => {
        dialog.querySelectorAll('[data-agenda-close-session]').forEach(closer => {
            closer.addEventListener('click', () => dialog.close());
        });

        // A click that lands on the dialog element itself landed on the
        // backdrop: every piece of content sits in a child element.
        dialog.addEventListener('click', event => {
            if (event.target === dialog) dialog.close();
        });

        dialog.addEventListener('close', () => {
            if (!document.querySelector('.session-modal[open]')) {
                document.body.classList.remove('agenda-modal-open');
            }
            const iframe = dialog.querySelector('iframe[src*="youtube"]');
            if (iframe) {
                const src = iframe.src;
                iframe.src = '';
                iframe.src = src;
            }
        });
    });
}

/**
 * Day tabs.
 *
 * Replaces Bootstrap's tab plugin: it moves `aria-selected`, the roving
 * tabindex and each panel's `hidden` attribute, then re-measures the grid it
 * just revealed — every width read while a panel was hidden came back zero.
 */
function initializeDayTabs() {
    const tablist = document.getElementById('agenda-tabs');
    if (!tablist) return;

    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length === 0) return;

    const panelFor = tab => document.getElementById(tab.getAttribute('aria-controls'));

    function activate(tab, moveFocus) {
        tabs.forEach(other => {
            const isTarget = other === tab;
            other.classList.toggle('is-active', isTarget);
            other.setAttribute('aria-selected', isTarget ? 'true' : 'false');
            other.tabIndex = isTarget ? 0 : -1;
            const otherPanel = panelFor(other);
            if (otherPanel) otherPanel.hidden = !isTarget;
        });

        if (moveFocus) tab.focus();

        const panel = panelFor(tab);
        if (!panel) return;
        setTimeout(() => {
            recalcBreakWidths(panel.querySelector('.agenda-grid-container'));
            updateOverflowNavigation(panel);
        }, 50);
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab, false));
        tab.addEventListener('keydown', event => {
            let next = null;
            if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
            else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
            else if (event.key === 'Home') next = tabs[0];
            else if (event.key === 'End') next = tabs[tabs.length - 1];
            if (!next) return;
            event.preventDefault();
            activate(next, true);
        });
    });
}

function initializeSessionActionPropagation() {
    document.querySelectorAll('[data-agenda-stop-propagation]').forEach(element => {
        element.addEventListener('click', event => event.stopPropagation());
    });
}

/** Keeps a location filter's `active` class and its `aria-pressed` state together. */
function setLocationSelected(button, selected) {
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
}

function initializeLocationFiltering() {
    // Handle individual location buttons
    document.querySelectorAll('.location-filter-btn').forEach(button => {
        button.addEventListener('click', function () {
            const tabPane = this.closest('.agenda-panel');

            // Toggle active state for multiple selection
            this.classList.toggle('active');
            this.setAttribute('aria-pressed', this.classList.contains('active') ? 'true' : 'false');

            filterByMultipleLocations(tabPane);
        });
    });

    // Handle "All Locations" button
    document.querySelectorAll('#select-all-locations').forEach(button => {
        button.addEventListener('click', function () {
            const tabPane = this.closest('.agenda-panel');
            const locationBtns = tabPane.querySelectorAll('.location-filter-btn');

            // Select all locations
            locationBtns.forEach(btn => setLocationSelected(btn, true));
            filterByMultipleLocations(tabPane);
        });
    });

    // Initialize all locations as selected by default - run after a short delay to ensure DOM is ready
    setTimeout(() => {
        document.querySelectorAll('.desktop-agenda').forEach(desktopAgenda => {
            const tabPane = desktopAgenda.closest('.agenda-panel');
            const locationBtns = tabPane.querySelectorAll('.location-filter-btn');

            // Only initialize if no buttons are already active
            const activeButtons = tabPane.querySelectorAll('.location-filter-btn.active');
            if (activeButtons.length === 0) {
                locationBtns.forEach(btn => setLocationSelected(btn, true));
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
            if (container.classList.contains('agenda-fullscreen')) {
                // Exit fullscreen
                container.classList.remove('agenda-fullscreen');
                document.body.style.overflow = '';
                this.title = 'Toggle Fullscreen';
                this.setAttribute('aria-label', this.title);
                setTimeout(() => recalcBreakWidths(container.querySelector('.agenda-grid-container')), 100);
            } else {
                // Enter fullscreen
                container.classList.add('agenda-fullscreen');
                document.body.style.overflow = 'hidden';
                this.title = 'Exit Fullscreen';
                this.setAttribute('aria-label', this.title);
                setTimeout(() => recalcBreakWidths(container.querySelector('.agenda-grid-container')), 150);
            }
        });
    });

    // ESC key to exit fullscreen
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        // An open dialog owns Escape; the browser closes it and the agenda
        // stays where the reader left it.
        if (document.querySelector('.session-modal[open]')) return;
        const container = document.getElementById('agenda-container');
        if (container && container.classList.contains('agenda-fullscreen')) {
            container.classList.remove('agenda-fullscreen');
            document.body.style.overflow = '';
            fullscreenBtns.forEach(btn => {
                btn.title = 'Toggle Fullscreen';
                btn.setAttribute('aria-label', btn.title);
            });
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
                btn.setAttribute('aria-label', btn.title);
                btn.classList.toggle('pk-btn--primary', expanded);
                btn.classList.toggle('pk-btn--secondary', !expanded);
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
        const leftArrow = document.createElement('button');
        leftArrow.type = 'button';
        leftArrow.className = 'scroll-arrow scroll-left disabled';
        leftArrow.setAttribute('aria-label', 'Scroll the agenda left');
        leftArrow.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
        `;

        const rightArrow = document.createElement('button');
        rightArrow.type = 'button';
        rightArrow.className = 'scroll-arrow scroll-right';
        rightArrow.setAttribute('aria-label', 'Scroll the agenda right');
        rightArrow.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
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
