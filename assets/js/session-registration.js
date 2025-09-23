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

  connectedCallback() {
    console.log('SessionRegistration connected');
    this.userIdWithSignature = window.location.hash.substring(1);
    console.log('Hash:', this.userIdWithSignature);
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
    console.log('User ID:', this.userId, 'Signature:', this.signature);
    this.loadData();
  }

  async loadData() {
    console.log('loadData called');
    this.isLoading = true;
    this.errorMessage = '';
    this.render();

    const timeout = setTimeout(() => {
      console.log('Timeout triggered');
      if (this.isLoading) {
        this.errorMessage = 'Loading timed out. Please check your connection or try again later.';
        this.isLoading = false;
        this.render();
      }
    }, 10000); // 10 seconds timeout

    try {
      console.log('Starting fetches');
      const [sessionsResponse, registrationResponse] = await Promise.all([
        fetch('/api/events/sessions'),
        fetch(`/api/events/sessions/users/${this.userId}?signature=${encodeURIComponent(this.signature)}`)
      ]);
      console.log('Fetches completed');

      clearTimeout(timeout);

      if (!sessionsResponse.ok) {
        console.log('Sessions response not ok:', sessionsResponse.status);
        throw new Error('Failed to load sessions.');
      }
      if (!registrationResponse.ok) {
        console.log('Registration response not ok:', registrationResponse.status);
        throw new Error('Failed to load registration.');
      }

      this.sessions = await sessionsResponse.json();
      this.userRegistration = await registrationResponse.json();
      console.log('Data loaded successfully');
    } catch (error) {
      console.log('Error in loadData:', error);
      clearTimeout(timeout);
      this.errorMessage = error.message;
    } finally {
      this.isLoading = false;
      console.log('Setting isLoading to false');
      this.render();
    }
  }

  async updateRegistration(morningSession, afternoonSession) {
    console.log('updateRegistration called with', morningSession, afternoonSession);
    this.errorMessage = '';
    this.render();

    try {
      const response = await fetch(`/api/events/sessions/users/${this.userId}/update?signature=${encodeURIComponent(this.signature)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ morningSession, afternoonSession })
      });
      console.log('Update response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Update failed.');
      }

      const result = await response.json();
      if (result.success) {
        console.log('Update successful, reloading data');
        this.loadData(); // Reload data
      } else {
        this.errorMessage = result.message || 'Update failed.';
        this.render();
      }
    } catch (error) {
      console.log('Error in updateRegistration:', error);
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
      const morningSessions = this.sessions.filter(s => s.timeSlot === 'morning');
      const afternoonSessions = this.sessions.filter(s => s.timeSlot === 'afternoon');

      content = `
        <div class="card">
          <div class="card-header">
            <h5 class="card-title">Session Registrations</h5>
          </div>
          <div class="card-body">
            <p class="text-muted small">You're already registered for some sessions, great! If you'd like to make any changes, simply resubmit this form to update your selections.</p>
            
            <!-- Current Registration Status -->
            <div class="row mb-4">
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

            <hr>
            <form id="registration-form">
              <div class="mb-4">
                <h5 class="mb-3">Select Morning Session</h5>
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <div class="card h-100 ${!this.userRegistration?.morningSession ? 'bg-primary-subtle border-primary' : ''}">
                      <div class="card-body">
                        <div class="form-check">
                          <input class="form-check-input" type="radio" name="morning" id="morning-none" value="" ${!this.userRegistration?.morningSession ? 'checked' : ''}>
                          <label class="form-check-label" for="morning-none">
                            <h6 class="card-title mb-1"><strong>No Selection</strong></h6>
                            <p class="card-text small text-muted">Skip morning session</p>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                  ${morningSessions.map((s, index) => `
                    <div class="col-md-6 mb-3">
                      <div class="card h-100 ${s.available ? (this.userRegistration?.morningSession === s.title ? 'bg-success-subtle border-success' : '') : 'border-warning'}">
                        <div class="card-body">
                          <div class="form-check">
                            <input class="form-check-input" type="radio" name="morning" id="morning-${index}" value="${s.title}" ${this.userRegistration?.morningSession === s.title ? 'checked' : ''} ${s.available ? '' : 'disabled'}>
                            <label class="form-check-label" for="morning-${index}">
                              <h6 class="card-title mb-1"><strong>${s.title}</strong></h6>
                              ${s.speakers && s.speakers.length > 0 ? `
                                <div class="mb-2">
                                  ${s.speakers.map(speaker => `
                                    <div class="d-inline-block me-2 mb-1">
                                      ${speaker.headshot ? `
                                        <img src="${speaker.headshot.x150}" class="speaker-avatar rounded-circle me-1" alt="${speaker.name}" style="width: 24px; height: 24px; object-fit: cover;">
                                      ` : `
                                        <div class="speaker-avatar speaker-initial bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center me-1" style="width: 24px; height: 24px; font-size: 12px; font-weight: 600;">
                                          ${speaker.name.charAt(0).toUpperCase()}
                                        </div>
                                      `}
                                      <small class="text-muted">${speaker.name}</small>
                                    </div>
                                  `).join('')}
                                </div>
                              ` : ''}
                              ${s.abstract ? `<p class="card-text small">${this.stripMarkdown(s.abstract).length > 100 ? this.stripMarkdown(s.abstract).substring(0, 100) + '...' : this.stripMarkdown(s.abstract)}</p>` : ''}
                              ${s.available ? '' : '<p class="card-text small text-warning"><em>(Full)</em></p>'}
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
              <hr>
              <div class="mb-4">
                <h5 class="mb-3">Select Afternoon Session</h5>
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <div class="card h-100 ${!this.userRegistration?.afternoonSession ? 'bg-primary-subtle border-primary' : ''}">
                      <div class="card-body">
                        <div class="form-check">
                          <input class="form-check-input" type="radio" name="afternoon" id="afternoon-none" value="" ${!this.userRegistration?.afternoonSession ? 'checked' : ''}>
                          <label class="form-check-label" for="afternoon-none">
                            <h6 class="card-title mb-1"><strong>No Selection</strong></h6>
                            <p class="card-text small text-muted">Skip the afternoon session</p>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                  ${afternoonSessions.map((s, index) => `
                    <div class="col-md-6 mb-3">
                      <div class="card h-100 ${s.available ? (this.userRegistration?.afternoonSession === s.title ? 'bg-success-subtle border-success' : '') : 'border-warning'}">
                        <div class="card-body">
                          <div class="form-check">
                            <input class="form-check-input" type="radio" name="afternoon" id="afternoon-${index}" value="${s.title}" ${this.userRegistration?.afternoonSession === s.title ? 'checked' : ''} ${s.available ? '' : 'disabled'}>
                            <label class="form-check-label" for="afternoon-${index}">
                              <h6 class="card-title mb-1"><strong>${s.title}</strong></h6>
                              ${s.speakers && s.speakers.length > 0 ? `
                                <div class="mb-2">
                                  ${s.speakers.map(speaker => `
                                    <div class="d-inline-block me-2 mb-1">
                                      ${speaker.headshot ? `
                                        <img src="${speaker.headshot.x150}" class="speaker-avatar rounded-circle me-1" alt="${speaker.name}" style="width: 24px; height: 24px; object-fit: cover;">
                                      ` : `
                                        <div class="speaker-avatar speaker-initial bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center me-1" style="width: 24px; height: 24px; font-size: 12px; font-weight: 600;">
                                          ${speaker.name.charAt(0).toUpperCase()}
                                        </div>
                                      `}
                                      <small class="text-muted">${speaker.name}</small>
                                    </div>
                                  `).join('')}
                                </div>
                              ` : ''}
                              ${s.abstract ? `<p class="card-text small">${this.stripMarkdown(s.abstract).length > 100 ? this.stripMarkdown(s.abstract).substring(0, 100) + '...' : this.stripMarkdown(s.abstract)}</p>` : ''}
                              ${s.available ? '' : '<p class="card-text small text-warning"><em>(Full)</em></p>'}
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
              <button type="submit" class="btn btn-primary">Update Registration</button>
              <button type="button" class="btn btn-secondary ms-2" id="deregister-btn">Deregister All</button>
            </form>
          </div>
        </div>
      `;
    }

    this.innerHTML = content;

    // Attach event listeners
    const form = this.querySelector('#registration-form');
    if (form) {
      form.addEventListener('submit', (e) => {
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