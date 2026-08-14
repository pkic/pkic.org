window.addEventListener('DOMContentLoaded', () => {
    new PagefindUI({ 
        element: "#search",  
        baseUrl: "/",
        autofocus: true,
        showSubResults: true,
        showEmptyFilters: false
    });
});
