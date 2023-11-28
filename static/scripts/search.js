window.addEventListener('DOMContentLoaded', (event) => {
    new PagefindUI({ 
        element: "#search",  
        baseUrl: "/",
        showSubResults: true,
        showEmptyFilters: false
    });
});