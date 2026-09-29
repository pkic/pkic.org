class SessionRegistration extends HTMLElement {
  constructor() {
    super();
    this.userIdWithSignature = '';
    this.userId = '';
    this.sessions = [];
    this.userRegistration = null;
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
  }

  // Helper function to strip markdown formatting
  stripMarkdown(text) {
    if (!text) return '';
    
    return text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      // Remove links
      .replace(/ \[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Remove horizontal rules
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      // Clean up extra whitespace
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Helper function to escape HTML
  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(match) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[match];
    });
  }

  // Helper function to check if a session has valid speaker details
  shouldDisplaySession(session) {
    if (session.speakers && session.speakers.length > 0) {
      return session.speakers.some(speaker => speaker.headshot || speaker.title || speaker.bio);
    }
    return true; // Include sessions with no speakers listed
  }

  // Helper function to render current registration status
  renderCurrentRegistration() {
    return `
      <!-- Current Registration Status Panel -->
      <section class="pk-panel location-0-session" aria-labelledby="current-registrations-title">
        <div class="pk-panel__header">
          <h2 class="pk-panel__title" id="current-registrations-title">Current Session Registrations</h2>
        </div>
        <div class="pk-panel__body pk-stack">
          <p class="pk-small">You're already registered for some sessions, great! If you'd like to make any changes, simply resubmit the form below to update your selections.</p>

          <div class="pk-grid pk-grid--roomy">
            <div class="pk-panel">
              <div class="pk-panel__body pk-stack pk-stack--tight">
                <h3 class="pk-panel__title">Your Current <strong>Morning</strong> Session</h3>
                <p class="pk-strong">${this.escapeHTML(this.userRegistration?.morningSession) || 'No selection'}</p>
              </div>
            </div>
            <div class="pk-panel">
              <div class="pk-panel__body pk-stack pk-stack--tight">
                <h3 class="pk-panel__title">Your Current <strong>Afternoon</strong> Session</h3>
                <p class="pk-strong">${this.escapeHTML(this.userRegistration?.afternoonSession) || 'No selection'}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  // Helper function to render session list
  renderSessionList(sessions, timeSlot, userSelection) {
    const sessionType = timeSlot === 'morning' ? 'morning' : 'afternoon';
    const locationClass = timeSlot === 'morning' ? 'location-1-session' : 'location-2-session';
    const title = timeSlot === 'morning' ? 'Morning Sessions' : 'Afternoon Sessions';

    const titleId = `${sessionType}-sessions-title`;

    return `
      <!-- ${title} Panel -->
      <section class="pk-panel ${locationClass}" aria-labelledby="${titleId}">
        <div class="pk-panel__header">
          <h2 class="pk-panel__title" id="${titleId}">${title}</h2>
        </div>
        <div class="pk-panel__body">
          <div class="pk-grid pk-grid--roomy">
            <div class="session-card${!userSelection ? ' registered' : ''}">
              <div class="session-content pk-stack pk-stack--snug">
                <label class="pk-check" for="${sessionType}-none">
                  <input class="pk-check__input" type="radio" name="${sessionType}" id="${sessionType}-none" value="" ${!userSelection ? 'checked' : ''}>
                  <span class="pk-check__label session-title">No Selection<span class="pk-check__hint">Select this option if you prefer not to attend any ${sessionType} sessions.</span></span>
                </label>
              </div>
            </div>
            ${sessions.map((s) => {
              const isRegistered = userSelection === s.title;
              const isFullForOthers = !s.available && !isRegistered;

              let cardClasses = 'session-card';
              if (isRegistered) {
                cardClasses += ' registered';
              } else if (isFullForOthers) {
                cardClasses += ' full';
              }

              return `
              <div class="${cardClasses}">
                ${isFullForOthers ? `
                  <div class="session-full-overlay">
                    <span class="session-full-text">FULL</span>
                  </div>
                ` : ''}
                <div class="session-content pk-stack pk-stack--snug">
                  <label class="pk-check" for="${sessionType}-${s.id}">
                    <input class="pk-check__input" type="radio" name="${sessionType}" id="${sessionType}-${s.id}" value="${this.escapeHTML(s.title)}" ${isRegistered ? 'checked' : ''} ${isFullForOthers ? 'disabled' : ''}>
                    <span class="pk-check__label session-title">${this.escapeHTML(s.title)}</span>
                  </label>
                  ${s.speakers && s.speakers.length > 0 ? `
                    <div class="session-speakers">
                      ${s.speakers.map(speaker => `
                        <div class="speaker-info">
                          ${speaker.headshot ? `
                            <img src="${this.escapeHTML(speaker.headshot.x150)}" class="speaker-avatar" alt="${this.escapeHTML(speaker.name)}">
                          ` : `
                            <div class="speaker-avatar speaker-initial">
                              ${this.escapeHTML(speaker.name.charAt(0).toUpperCase())}
                            </div>
                          `}
                          <div class="speaker-details">
                            <div class="speaker-name">${this.escapeHTML(speaker.name)}</div>
                            <div class="speaker-role">${this.escapeHTML(speaker.title)}</div>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                  ${s.abstract ? `
                    <div class="session-preview-wrapper">
                      <div class="session-preview-gradient">${this.escapeHTML(this.stripMarkdown(s.abstract))}</div>
                    </div>
                  ` : ''}
                </div>
              </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;
  }

  connectedCallback() {
    this.userIdWithSignature = window.location.hash.substring(1);
    if (!this.userIdWithSignature) {
      this.errorMessage = 'No user ID provided in URL hash.';
      this.isLoading = false;
      this.render();
      return;
    }
    const parts = this.userIdWithSignature.split('.');
    if (parts.length !== 2) {
      this.errorMessage = 'Invalid user ID format.';
      this.isLoading = false;
      this.render();
      return;
    }
    this.userId = parts[0];
    this.signature = parts[1];
    this.loadData();
  }

  async loadData(skipSpinner = false) {
    if (!skipSpinner) {
      this.isLoading = true;
      this.render();
    }

    const controller = new AbortController();
    const signal = controller.signal;

    const timeout = setTimeout(() => {
      if (this.isLoading) {
        controller.abort();
        this.errorMessage = 'Loading timed out. Please check your connection or try again later.';
        this.isLoading = false;
        this.render();
      }
    }, 10000); // 10 seconds timeout

    try {
      const [sessionsResponse, registrationResponse] = await Promise.all([
        fetch('/api/events/sessions', { signal }),
        fetch(`/api/events/sessions/users/${this.userId}?signature=${encodeURIComponent(this.signature)}`, { signal })
      ]);

      clearTimeout(timeout);

      if (!sessionsResponse.ok) {
        throw new Error('Failed to load sessions.');
      }
      if (!registrationResponse.ok) {
        throw new Error('Failed to load registration.');
      }

      this.sessions = await sessionsResponse.json();
      this.userRegistration = await registrationResponse.json();
    } catch (error) {
      if (error.name !== 'AbortError') {
        clearTimeout(timeout);
        this.errorMessage = error.message;
      }
    } finally {
      if (!signal.aborted) {
        this.isLoading = false;
        this.render();
      }
    }
  }

  async updateRegistration(morningSession, afternoonSession) {
    // Clear messages immediately for responsiveness
    this.successMessage = '';
    this.errorMessage = '';
    this.render();

    try {
      const response = await fetch(`/api/events/sessions/users/${this.userId}?signature=${encodeURIComponent(this.signature)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ morningSession, afternoonSession })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        this.successMessage = 'Your session registration has been saved successfully!';
        await this.loadData(); // Reload and re-render
      } else {
        this.errorMessage = result.message || 'An unknown error occurred.';
        if (response.status === 409) {
          // For a conflict, we want to show the error *while* reloading the data.
          // We render the error first, then loadData without showing the main spinner.
          this.isLoading = false;
          this.render();
          await this.loadData(true); // Pass flag to skip spinner
        } else {
          this.render();
        }
      }
    } catch (error) {
      this.errorMessage = error.message;
      this.render();
    }
  }

  render() {
    let content;
    const hasError = this.errorMessage && this.errorMessage.length > 0;
    const hasSuccess = this.successMessage && this.successMessage.length > 0;

    // Priority: Error > Loading > Success > Form
    if (hasError) {
      content = this.renderErrorState();
    } else if (this.isLoading) {
      // The design system's loading placeholder, not a spinner: Spinner ships in
      // a lazy chunk, while pk-skeleton rides the entry stylesheet this
      // server-rendered page already links.
      content =
        '<div class="pk-stack pk-stack--snug" role="status" aria-live="polite">' +
        '<p class="pk-center pk-muted">Loading session data…</p>' +
        '<span class="pk-skeleton pk-skeleton--lg"></span>' +
        '<span class="pk-skeleton"></span>' +
        '<span class="pk-skeleton"></span>' +
        '</div>';
    } else if (hasSuccess) {
      content = this.renderSuccessState();
    } else {
      content = this.renderForm();
    }

    // The base layer is scoped to `.pk`, so the host element carries it.
    this.classList.add('pk');
    this.innerHTML = `<div class="pk-stack pk-stack--loose">${content}</div>`;
    this.attachEventListeners();

    const messageEl = this.querySelector('#error-message, #success-message');
    if (messageEl) {
      messageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  renderErrorState() {
    let messageContent;
    if (this.errorMessage.includes('just filled up')) {
      messageContent = `
        <div id="error-message" class="pk-alert pk-alert--danger pk-stack pk-stack--tight" role="alert">
          <p class="pk-alert__title">Save Failed</p>
          <p class="pk-alert__body">${this.escapeHTML(this.errorMessage)}</p>
          <p class="pk-alert__body">The session list is being updated. Please make a new selection.</p>
        </div>
      `;
    } else {
      messageContent = `<div id="error-message" class="pk-alert pk-alert--danger" role="alert"><p class="pk-alert__body">${this.escapeHTML(this.errorMessage)}</p></div>`;
    }
    // Show the form below the error
    return messageContent + this.renderForm();
  }

  renderSuccessState() {
    const successContent = `
      <div id="success-message" class="pk-alert pk-alert--ok" role="alert">
        <p class="pk-alert__body">${this.escapeHTML(this.successMessage)}</p>
      </div>
    `;
    // Show the form below the success message
    return successContent + this.renderForm();
  }

  renderForm() {
    const morningSessions = this.sessions.filter(s => s.timeSlot === 'morning').filter(s => this.shouldDisplaySession(s));
    const afternoonSessions = this.sessions.filter(s => s.timeSlot === 'afternoon').filter(s => this.shouldDisplaySession(s));

    return `
      ${this.renderCurrentRegistration()}

      <!-- Session Selection Form -->
      <form id="registration-form" class="pk-stack pk-stack--loose">
        ${this.renderSessionList(morningSessions, 'morning', this.userRegistration?.morningSession)}
        ${this.renderSessionList(afternoonSessions, 'afternoon', this.userRegistration?.afternoonSession)}

        <!-- Save Button -->
        <div class="pk-cluster pk-cluster--center">
          <button type="submit" class="pk-btn pk-btn--primary pk-btn--lg">Save Session Registrations</button>
        </div>
      </form>

      <!-- Deregister All Button -->
      <div class="pk-cluster pk-cluster--center">
        <button type="button" class="pk-btn pk-btn--secondary" id="deregister-btn">Deregister All Sessions</button>
      </div>
    `;
  }

  attachEventListeners() {
    // Attach event listeners
    const registrationForm = this.querySelector('#registration-form');
    if (registrationForm) {
      registrationForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const morningSelection = this.querySelector('input[name="morning"]:checked')?.value || '';
        const afternoonSelection = this.querySelector('input[name="afternoon"]:checked')?.value || '';
        this.updateRegistration(morningSelection, afternoonSelection);
      });
    }

    const deregisterBtn = this.querySelector('#deregister-btn');
    if (deregisterBtn) {
      deregisterBtn.addEventListener('click', () => {
        this.updateRegistration('', '');
      });
    }

    const sessionCards = this.querySelectorAll('.session-card');
    sessionCards.forEach(card => {
      card.addEventListener('click', (event) => {
        // Don't do anything if a link or button inside the card was clicked
        if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.closest('a, button')) {
          return;
        }

        const radio = card.querySelector('input[type="radio"]');
        if (radio && !radio.disabled) {
          radio.checked = true;
        }
      });
    });
  }
}

customElements.define('session-registration', SessionRegistration);
