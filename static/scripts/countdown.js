const countdownElement = document.getElementById('countdown');
const logoElement = document.getElementById('logoElement');

let countdownValue = 60;
let intervalId;
let isPaused = false;

function startCountdown() {
  if (!countdownElement || !logoElement) return;

  clearInterval(intervalId);
  intervalId = setInterval(() => {
    if (!isPaused && countdownValue > 0) {
      countdownValue--;
      countdownElement.textContent = countdownValue;
    } else if (countdownValue === 0) {
      const elements = logoElement.querySelectorAll('*');
      elements.forEach(element => {
        element.classList.add('blink');
      });
    }
  }, 1000);
}

document.addEventListener('keydown', (event) => {
  if (!countdownElement || !logoElement) return;

  if (event.key === 'r') {
    const elements = logoElement.querySelectorAll('*');
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
