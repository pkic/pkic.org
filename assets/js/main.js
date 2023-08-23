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