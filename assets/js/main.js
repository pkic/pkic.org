import * as bootstrap from 'js/bootstrap';

var e = document.querySelectorAll('.nav-tabs .nav-link');
for (var i = 0; i < e.length; i++) {
    e[i].addEventListener("click", event => {
        location.hash = event.target.dataset.bsTarget;
    
        var se =  document.getElementById(event.target.parentElement.dataset.scrollTarget);
        se.scrollIntoView();
    })
}

if (window.location.hash.indexOf('nav') == 1) {
    document.getElementById(window.location.hash.substr(1) + '-tab').click();
}

document.querySelectorAll('time[datetime]').forEach($e => {
    const date = new Date($e.dateTime);
    $e.title = date.toString();
    const originalText = $e.textContent;

    if ($e.classList.contains('localTime')) {
        const options = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', hour12: false };
        $e.textContent = date.toLocaleTimeString([], options).replace(',', '');
    }
});

// Sidebar toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarMenu = document.getElementById('sidebarMenu');
    const content = document.getElementById('content');
    
    if (sidebarToggle && sidebarMenu && content) {
        const chevronIcon = sidebarToggle.querySelector('svg');
        chevronIcon.style.transition = 'transform 0.3s ease-in-out';
        
        // Initialize sidebar state based on current visibility
        // Check if sidebar is currently visible (not d-none and not display:none)
        const isCurrentlyVisible = !sidebarMenu.classList.contains('d-none') && 
                                 sidebarMenu.style.display !== 'none' && 
                                 sidebarMenu.offsetWidth > 0;
        
        if (isCurrentlyVisible) {
            // Sidebar is visible, set chevron to left (can close)
            sidebarMenu.classList.add('show');
            chevronIcon.style.transform = 'rotate(0deg)';
        } else {
            // Sidebar is hidden, set chevron to right (can open)
            sidebarMenu.classList.remove('show');
            chevronIcon.style.transform = 'rotate(180deg)';
        }
        
        sidebarToggle.addEventListener('click', function() {
            // Toggle the sidebar visibility
            if (!sidebarMenu.classList.contains('show')) {
                // Show sidebar
                sidebarMenu.style.display = 'block';
                sidebarMenu.classList.remove('d-none');
                sidebarMenu.classList.add('d-md-block', 'show');
                
                // Adjust content to normal width (8/9 columns)
                content.classList.remove('col-12');
                content.classList.add('col-md-8', 'ms-sm-auto', 'col-lg-9');
                
                // Rotate chevron to left (indicating sidebar is open, can close)
                chevronIcon.style.transform = 'rotate(0deg)';
            } else {
                // Hide sidebar
                sidebarMenu.classList.remove('show');
                
                // Expand content to full width (12 columns)
                content.classList.remove('col-md-8', 'ms-sm-auto', 'col-lg-9');
                content.classList.add('col-12');
                
                // Rotate chevron to right (indicating sidebar is closed, can open)
                chevronIcon.style.transform = 'rotate(180deg)';
                
                // Hide sidebar after animation completes
                setTimeout(() => {
                    sidebarMenu.style.display = 'none';
                    sidebarMenu.classList.add('d-none');
                    sidebarMenu.classList.remove('d-md-block');
                }, 300);
            }
        });
    }
});
