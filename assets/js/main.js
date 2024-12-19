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
