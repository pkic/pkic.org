class SessionRegistration extends HTMLElement {
  constructor() {
    super();
    this.userIdWithSignature = '';
    this.userId = '';
    this.sessions = [];
    this.userRegistration = null;
    this.isLoading = true;
    this.errorMessage = '';
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
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      // Remove list markers
      .replace(/^[\s]*[-\*\+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '')
      // Clean up extra whitespace
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Helper function to check if a session has valid speaker details
  hasSpeakerDetails(session) {
    if (session.speakers && session.speakers.length > 0) {
      return session.speakers.some(speaker => speaker.headshot || speaker.title || speaker.bio);
    }
    return true; // Include sessions with no speakers listed
  }

  // Helper function to render current registration status
  renderCurrentRegistration() {
    return `
      <!-- Current Registration Status Card -->
      <div class="card mb-4 location-0-session">
        <div class="card-header location-0-session">
          <h5 class="card-title mb-0 text-white">Current Session Registrations</h5>
        </div>
        <div class="card-body">
          <p class="text-muted small">You're already registered for some sessions, great! If you'd like to make any changes, simply resubmit the form below to update your selections.</p>
          
          <div class="row">
            <div class="col-md-6">
              <div class="card border-primary">
                <div class="card-body">
                  <h6 class="card-title text-primary">Current Morning Session</h6>
                  <p class="card-text fw-bold">${this.userRegistration?.morningSession || 'No selection'}</p>
                </div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="card border-primary">
                <div class="card-body">
                  <h6 class="card-title text-primary">Current Afternoon Session</h6>
                  <p class="card-text fw-bold">${this.userRegistration?.afternoonSession || 'No selection'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Helper function to render session list
  renderSessionList(sessions, timeSlot, userSelection) {
    const sessionType = timeSlot === 'morning' ? 'morning' : 'afternoon';
    const locationClass = timeSlot === 'morning' ? 'location-1-session' : 'location-2-session';
    const title = timeSlot === 'morning' ? 'Morning Sessions' : 'Afternoon Sessions';

    return `
      <!-- ${title} Card -->
      <div class="card mb-4 ${locationClass}">
        <div class="card-header ${locationClass}">
          <h5 class="card-title mb-0 text-white">${title}</h5>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="col-md-6 mb-3">
              <div class="session-card h-100 ${!userSelection ? 'bg-primary-subtle border-primary' : ''}">
                <div class="session-content">
                  <div class="form-check mb-2">
                    <input class="form-check-input" type="radio" name="${sessionType}" id="${sessionType}-none" value="" ${!userSelection ? 'checked' : ''}>
                    <label class="form-check-label w-100" for="${sessionType}-none">
                      <h6 class="session-title mb-2"><strong>No Selection</strong></h6>
                      <p class="text-muted small">Select this option if you prefer not to attend any ${sessionType} sessions.</p>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            ${sessions.map((s, index) => `
              <div class="col-md-6 mb-3">
                <div class="session-card h-100 ${s.available ? (userSelection === s.title ? 'bg-success-subtle border-success' : '') : 'border-warning'}">
                  <div class="session-content">
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="radio" name="${sessionType}" id="${sessionType}-${index}" value="${s.title}" ${userSelection === s.title ? 'checked' : ''} ${s.available ? '' : 'disabled'}>
                      <label class="form-check-label w-100" for="${sessionType}-${index}">
                        <h6 class="session-title mb-2"><strong>${s.title}</strong></h6>
                      </label>
                    </div>
                    ${s.speakers && s.speakers.length > 0 ? `
                      <div class="session-speakers mb-2">
                        ${s.speakers.map(speaker => `
                          <div class="speaker-info">
                            ${speaker.headshot ? `
                              <img src="${speaker.headshot.x150}" class="speaker-avatar" alt="${speaker.name}">
                            ` : `
                              <div class="speaker-avatar speaker-initial">
                                ${speaker.name.charAt(0).toUpperCase()}
                              </div>
                            `}
                            <div class="speaker-details">
                              <div class="speaker-name">${speaker.name}</div>
                              <div class="speaker-role">${speaker.title}</div>
                            </div>
                          </div>
                        `).join('')}
                      </div>
                    ` : ''}
                    ${s.abstract ? `
                      <div class="session-preview-wrapper">
                        <div class="session-preview-gradient">${this.stripMarkdown(s.abstract)}</div>
                      </div>
                    ` : ''}
                    ${s.available ? '' : '<p class="text-warning small mt-2"><em>(Full)</em></p>'}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
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

  async loadData() {
    this.isLoading = true;
    this.errorMessage = '';
    this.render();

    const timeout = setTimeout(() => {
      if (this.isLoading) {
        this.errorMessage = 'Loading timed out. Please check your connection or try again later.';
        this.isLoading = false;
        this.render();
      }
    }, 10000); // 10 seconds timeout

    try {
      const [sessionsResponse, registrationResponse] = await Promise.all([
        fetch('/api/events/sessions'),
        fetch(`/api/events/sessions/users/${this.userId}?signature=${encodeURIComponent(this.signature)}`)
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
      clearTimeout(timeout);
      this.errorMessage = error.message;
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  async updateRegistration(morningSession, afternoonSession) {
    this.errorMessage = '';
    this.render();

    try {
      const response = await fetch(`/api/events/sessions/users/${this.userId}/update?signature=${encodeURIComponent(this.signature)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ morningSession, afternoonSession })
      });

      if (!response.ok) {
        let errorMessage = `Update failed with status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // The error response was not valid JSON, use the default message
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      if (result.success) {
        this.loadData(); // Reload data
      } else {
        this.errorMessage = result.message || 'Update failed.';
        this.render();
      }
    } catch (error) {
      this.errorMessage = error.message;
      this.render();
    }
  }

  render() {
    let content = '';

    if (this.isLoading) {
      content = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Loading session data...</p></div>';
    } else if (this.errorMessage) {
      content = `<div class="alert alert-danger" role="alert">${this.errorMessage}</div>`;
    } else {
      const morningSessions = this.sessions.filter(s => s.timeSlot === 'morning').filter(s => this.hasSpeakerDetails(s));
      const afternoonSessions = this.sessions.filter(s => s.timeSlot === 'afternoon').filter(s => this.hasSpeakerDetails(s));

      content = `
        ${this.renderCurrentRegistration()}

        <!-- Session Selection Form -->
        <form id="registration-form">
          ${this.renderSessionList(morningSessions, 'morning', this.userRegistration?.morningSession)}
          ${this.renderSessionList(afternoonSessions, 'afternoon', this.userRegistration?.afternoonSession)}

          <!-- Save Button -->
          <div class="text-center mb-4">
            <button type="submit" class="btn btn-primary btn-lg location-0-session-btn">Save Session Registrations</button>
          </div>
        </form>

        <!-- Deregister All Button -->
        <div class="text-center">
          <button type="button" class="btn btn-secondary" id="deregister-btn">Deregister All Sessions</button>
        </div>
      `;
    }

    this.innerHTML = content;

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
  }
}

customElements.define('session-registration', SessionRegistration);