(function () {
    'use strict'
  
    // Fetch all the forms we want to apply custom Bootstrap validation styles to
    var forms = document.querySelectorAll('.needs-validation')
  
    // Loop over them and prevent submission
    Array.prototype.slice.call(forms)
      .forEach(function (form) {
        form.addEventListener('submit', function (event) {
          if (!form.checkValidity()) {
            event.preventDefault()
            event.stopPropagation()
          }
  
          form.classList.add('was-validated')
        }, false)
      })
  
      let params = new URLSearchParams(document.location.search.substring(1));
      if (params.get("status") === 'success') {
          document.getElementById("inputForm").classList.add("visually-hidden");
          document.getElementById("formSuccess").classList.remove("visually-hidden");
      } else if (params.get("status") === 'error') {
          document.getElementById("inputForm").classList.add("visually-hidden");
          document.getElementById("formError").classList.remove("visually-hidden");
      }

      // Make fields required, or not, depending on the category
      const matches = document.querySelectorAll('input[name="Category"]');
      const categoryChanged = (e) => {
        if (e.target.id == "category-h5" || 
            e.target.id == "category-h6" || 
            e.target.id == "category-h7") {
              
          document.getElementById("role").required = false;
          document.getElementById("organization").required = false;
          document.getElementById("aboutorganization").required = false;
        } else {
          document.getElementById("role").required = true;
          document.getElementById("organization").required = true;
          document.getElementById("aboutorganization").required = true;
        }
      }
      matches.forEach(match => {
        match.addEventListener('change', categoryChanged);
      })

      // Load existing members and validate organization name
      let existingMembers = [];

      fetch('/members/members-data.json')
        .then(response => response.json())
        .then(data => {
          existingMembers = data.map(member => member.title.toLowerCase().trim());
        })
        .catch(err => {
          console.warn('Could not load member data for validation:', err);
        });

      const organizationInput = document.getElementById('organization');
      const organizationHelp = document.getElementById('organizationHelp');

      if (organizationInput) {
        // Create a warning element for duplicate organization
        const warningDiv = document.createElement('div');
        warningDiv.id = 'organizationWarning';
        warningDiv.className = 'form-text text-warning fw-bold';
        warningDiv.style.display = 'none';
        organizationHelp.parentNode.insertBefore(warningDiv, organizationHelp.nextSibling);

        organizationInput.addEventListener('blur', function() {
          const orgName = this.value.toLowerCase().trim();

          if (orgName && existingMembers.length > 0) {
            const isDuplicate = existingMembers.some(member => {
              // Check for exact match or very close match
              return member === orgName ||
                     member.includes(orgName) ||
                     orgName.includes(member);
            });

            if (isDuplicate) {
              warningDiv.textContent = '⚠️ Warning: An organization with a similar name is already a member of the PKI Consortium. If this is your organization, please contact us at members@pkic.org instead of submitting a new application.';
              warningDiv.style.display = 'block';
              organizationInput.classList.add('border-warning');
            } else {
              warningDiv.style.display = 'none';
              organizationInput.classList.remove('border-warning');
            }
          }
        });

        // Also check on input for real-time feedback
        let debounceTimer;
        organizationInput.addEventListener('input', function() {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const orgName = this.value.toLowerCase().trim();

            if (orgName && existingMembers.length > 0) {
              const isDuplicate = existingMembers.some(member => {
                return member === orgName ||
                       member.includes(orgName) ||
                       orgName.includes(member);
              });

              if (isDuplicate) {
                warningDiv.textContent = '⚠️ Warning: An organization with a similar name is already a member of the PKI Consortium. If this is your organization, please contact us at members@pkic.org instead of submitting a new application.';
                warningDiv.style.display = 'block';
                organizationInput.classList.add('border-warning');
              } else {
                warningDiv.style.display = 'none';
                organizationInput.classList.remove('border-warning');
              }
            }
          }, 500);
        });
      }

  })()