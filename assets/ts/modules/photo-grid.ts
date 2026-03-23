document.addEventListener('DOMContentLoaded', () => {
    const cells = document.querySelectorAll('.pkic-photo-cell');
    
    cells.forEach(cell => {
        const images = cell.querySelectorAll<HTMLImageElement>('img.pkic-photo-transition');
        if (images.length <= 1) return;
        
        let currentIndex = 0;
        
        // Random start delay between 0 and 5s so they don't all fade exactly at once
        const delay = Math.random() * 5000;
        const duration = 6000; // 6 seconds per photo
        
        setTimeout(() => {
            setInterval(() => {
                images[currentIndex].classList.remove('active');
                currentIndex = (currentIndex + 1) % images.length;
                images[currentIndex].classList.add('active');
            }, duration);
        }, delay);
    });
});
