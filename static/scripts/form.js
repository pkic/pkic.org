(function () {
    'use strict'

    // Fetch all the forms we want to apply custom Bootstrap validation styles to
    const forms = document.querySelectorAll('.needs-validation')

    // Loop over them and prevent submission
    forms.forEach(function (form) {
      form.addEventListener('submit', function (event) {
        if (!form.checkValidity()) {
          event.preventDefault()
          event.stopPropagation()
        }

        form.classList.add('was-validated')
      }, false)
    })

    // Handle form submission status messages
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");

    if (status === 'success' || status === 'error') {
      const inputForm = document.getElementById("inputForm");
      const statusElement = document.getElementById(status === 'success' ? "formSuccess" : "formError");

      if (inputForm) inputForm.classList.add("visually-hidden");
      if (statusElement) statusElement.classList.remove("visually-hidden");
    }

    // Make fields required, or not, depending on the category
    const categoryInputs = document.querySelectorAll('input[name="Category"]');
    const roleField = document.getElementById("role");
    const organizationField = document.getElementById("organization");
    const aboutOrganizationField = document.getElementById("aboutorganization");

    // Individual categories that don't require organization fields
    const individualCategories = new Set(["category-h5", "category-h6", "category-h7"]);

    const categoryChanged = (e) => {
      const isIndividual = individualCategories.has(e.target.id);

      if (roleField) roleField.required = !isIndividual;
      if (organizationField) organizationField.required = !isIndividual;
      if (aboutOrganizationField) aboutOrganizationField.required = !isIndividual;
    }

    categoryInputs.forEach(input => {
      input.addEventListener('change', categoryChanged);
    })

    // Organization duplicate detection
    const organizationInput = document.getElementById('organization');
    const organizationHelp = document.getElementById('organizationHelp');

    if (organizationInput && organizationHelp) {
      // Create a warning element for duplicate organization
      const warningDiv = document.createElement('div');
      warningDiv.id = 'organizationWarning';
      warningDiv.className = 'form-text text-warning fw-bold';
      warningDiv.style.display = 'none';
      organizationHelp.parentNode.insertBefore(warningDiv, organizationHelp.nextSibling);

      const WARNING_MESSAGE = '⚠️ Warning: An organization with a similar name is already a member of the PKI Consortium. If this is your organization, please contact us at members@pkic.org instead of submitting a new application.';
      let existingMembers = [];
      let debounceTimer;

      const validateOrganization = () => {
        const orgName = organizationInput.value.toLowerCase().trim();

        if (!orgName) {
          warningDiv.style.display = 'none';
          organizationInput.classList.remove('border-warning');
          return;
        }

        if (existingMembers.length === 0) return;

        const isDuplicate = existingMembers.some(member =>
          member === orgName ||
          member.includes(orgName) ||
          orgName.includes(member)
        );

        if (isDuplicate) {
          warningDiv.textContent = WARNING_MESSAGE;
          warningDiv.style.display = 'block';
          organizationInput.classList.add('border-warning');
        } else {
          warningDiv.style.display = 'none';
          organizationInput.classList.remove('border-warning');
        }
      };

      // Event listeners
      organizationInput.addEventListener('blur', validateOrganization);
      organizationInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(validateOrganization, 500);
      });

      // Load existing members list
      fetch('/members/members-data.json')
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          existingMembers = data.map(member => member.title.toLowerCase().trim());
          // Validate if user already typed something
          if (organizationInput.value) {
            validateOrganization();
          }
        })
        .catch(err => {
          console.warn('Could not load member data for validation:', err);
        });
    }
  })()