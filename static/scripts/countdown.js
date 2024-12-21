let countdownElement = document.getElementById('countdown');
let countdownValue = 60;
let intervalId;
let isPaused = false;

function startCountdown() {
  clearInterval(intervalId);
  intervalId = setInterval(() => {
    if (!isPaused && countdownValue > 0) {
      countdownValue--;
      countdownElement.textContent = countdownValue;
    } else if (countdownValue === 0) {
      let elements = logoElement.querySelectorAll('*');
      elements.forEach(element => {
        element.classList.add('blink');
      });
    }
  }, 1000);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'r') {
    let elements = logoElement.querySelectorAll('*');
    elements.forEach(element => {
      element.classList.remove('blink');
    });
    countdownValue = 60;
    countdownElement.textContent = countdownValue;
    isPaused = true;
    startCountdown();
  } else if (event.key === '+') {
    countdownValue += 10;
    countdownElement.textContent = countdownValue;
  } else if (event.key === '-') {
    countdownValue = Math.max(0, countdownValue - 10);
    countdownElement.textContent = countdownValue;
  } else if (event.key === ' ') {
    isPaused = !isPaused;
  }
});

startCountdown();