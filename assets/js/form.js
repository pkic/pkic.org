(function () {
  "use strict";

  // Public/personal email providers that aren't acceptable for category (h5)
  const PUBLIC_EMAIL_DOMAINS = new Set([
    "gmail.com",
    "googlemail.com",
    "proton.me",
    "protonmail.com",
    "protonmail.ch",
    "pm.me",
    "hotmail.com",
    "hotmail.co.uk",
    "hotmail.fr",
    "hotmail.it",
    "hotmail.de",
    "outlook.com",
    "live.com",
    "msn.com",
    "live.co.uk",
    "yahoo.com",
    "yahoo.co.uk",
    "yahoo.fr",
    "yahoo.de",
    "yahoo.it",
    "ymail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "aol.com",
    "aim.com",
    "mail.com",
    "gmx.com",
    "gmx.net",
    "gmx.de",
    "yandex.com",
    "yandex.ru",
    "zoho.com",
    "tutanota.com",
    "tuta.io",
    "fastmail.com",
    "fastmail.fm",
  ]);

  // Default URL fields to https:// if no protocol was entered
  const websiteField = document.getElementById("website");
  const linkedinField = document.getElementById("linkedin");
  const normalizeUrlField = (field) => {
    if (!field) return;
    let value = field.value.trim();
    if (value) {
      if (/^\/\//.test(value)) {
        value = `https:${value}`;
      } else if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
      }
      field.value = value;
    }
  };
  if (websiteField) {
    websiteField.addEventListener("blur", () => normalizeUrlField(websiteField));
  }
  if (linkedinField) {
    linkedinField.addEventListener("blur", () => normalizeUrlField(linkedinField));
  }

  // Fetch all the forms we want to apply custom Bootstrap validation styles to
  const forms = document.querySelectorAll(".needs-validation");

  // Loop over them and prevent submission
  forms.forEach(function (form) {
    form.addEventListener(
      "submit",
      function (event) {
        normalizeUrlField(websiteField);
        normalizeUrlField(linkedinField);

        if (!form.checkValidity()) {
          event.preventDefault();
          event.stopPropagation();
          form.classList.add("was-validated");
          return;
        }

        form.classList.add("was-validated");

        // Show spinner on the submit button while the native POST is in flight.
        // The page navigates away on success; on error the server redirects back
        // with ?status=error so button state resets on page reload automatically.
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML =
            '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>' +
            submitBtn.textContent.trim();
        }
      },
      false,
    );
  });

  // Handle form submission status messages
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");

  if (status === "success" || status === "error") {
    const inputForm = document.getElementById("inputForm");
    const statusElement = document.getElementById(status === "success" ? "formSuccess" : "formError");

    if (inputForm) inputForm.classList.add("visually-hidden");
    if (statusElement) statusElement.classList.remove("visually-hidden");
  }

  // Make fields required, or not, depending on the category
  const categoryInputs = document.querySelectorAll('input[name="Category"]');
  const postCategoryFields = document.getElementById("postCategoryFields");
  const roleField = document.getElementById("role");
  const organizationField = document.getElementById("organization");
  const aboutOrganizationField = document.getElementById("aboutorganization");

  // Individual categories that don't require organization fields
  const individualCategories = new Set(["category-h5", "category-h6", "category-h7"]);

  // Categories that are exclusively for individuals unaffiliated with any organization
  const blockedOrganizationCategories = new Set(["category-h5", "category-h6", "category-h7"]);

  // Category (h5) is for PhD students, so a public/personal email domain isn't acceptable
  const universityEmailCategories = new Set(["category-h5"]);

  const emailField = document.getElementById("email");
  const emailInvalidFeedback = document.getElementById("emailInvalidFeedback");
  let requireUniversityEmail = false;

  const validateEmail = () => {
    if (!emailField) return;

    const value = emailField.value.trim().toLowerCase();
    const domain = value.includes("@") ? value.substring(value.lastIndexOf("@") + 1) : "";

    if (requireUniversityEmail && domain && PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const message =
        "Category (h5) requires your university email address; public email providers (Gmail, Outlook, Hotmail, etc.) are not accepted.";
      emailField.setCustomValidity(message);
      if (emailInvalidFeedback) emailInvalidFeedback.textContent = message;
    } else {
      emailField.setCustomValidity("");
      if (emailInvalidFeedback) emailInvalidFeedback.textContent = "Please enter a valid email address.";
    }
  };

  if (emailField) {
    emailField.addEventListener("input", validateEmail);
    emailField.addEventListener("blur", validateEmail);
  }

  const categoryChanged = (input) => {
    if (postCategoryFields) postCategoryFields.classList.remove("d-none");

    const isIndividual = individualCategories.has(input.id);
    const isOrganizationBlocked = blockedOrganizationCategories.has(input.id);

    if (roleField) roleField.required = !isIndividual;
    if (websiteField) websiteField.required = !isIndividual;
    if (organizationField) {
      organizationField.required = !isIndividual;
      organizationField.disabled = isOrganizationBlocked;
      if (isOrganizationBlocked) {
        organizationField.value = "";
        organizationField.dispatchEvent(new Event("input"));
      }
    }
    if (aboutOrganizationField) {
      aboutOrganizationField.required = !isIndividual;
      aboutOrganizationField.disabled = isOrganizationBlocked;
      if (isOrganizationBlocked) {
        aboutOrganizationField.value = "";
      }
    }

    requireUniversityEmail = universityEmailCategories.has(input.id);
    validateEmail();
  };

  categoryInputs.forEach((input) => {
    input.addEventListener("change", () => categoryChanged(input));
    if (input.checked) {
      categoryChanged(input);
    }
  });

  // Organization duplicate detection
  const organizationInput = organizationField;
  const organizationHelp = document.getElementById("organizationHelp");

  if (organizationInput && organizationHelp) {
    // Create a warning element for duplicate organization
    const warningDiv = document.createElement("div");
    warningDiv.id = "organizationWarning";
    warningDiv.className = "form-text text-warning fw-bold";
    warningDiv.style.display = "none";
    organizationHelp.parentNode.insertBefore(warningDiv, organizationHelp.nextSibling);

    const WARNING_MESSAGE =
      "⚠️ Warning: An organization with a similar name is already a member of the PKI Consortium. If this is your organization, please contact us at members@pkic.org instead of submitting a new application.";
    let existingMembers = [];
    let debounceTimer;

    const validateOrganization = () => {
      const orgName = organizationInput.value.toLowerCase().trim();

      if (!orgName) {
        warningDiv.style.display = "none";
        organizationInput.classList.remove("border-warning");
        return;
      }

      if (existingMembers.length === 0) return;

      const isDuplicate = existingMembers.some((member) => {
        if (orgName.length < 3) {
          return member === orgName;
        }
        return member === orgName || member.includes(orgName) || orgName.includes(member);
      });

      if (isDuplicate) {
        warningDiv.textContent = WARNING_MESSAGE;
        warningDiv.style.display = "block";
        organizationInput.classList.add("border-warning");
      } else {
        warningDiv.style.display = "none";
        organizationInput.classList.remove("border-warning");
      }
    };

    // Event listeners
    organizationInput.addEventListener("blur", validateOrganization);
    organizationInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(validateOrganization, 500);
    });

    // Load existing members list
    fetch("/members/members-data.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        existingMembers = data.map((member) => member.title.toLowerCase().trim());
        // Validate if user already typed something
        if (organizationInput.value) {
          validateOrganization();
        }
      })
      .catch((err) => {
        console.warn("Could not load member data for validation:", err);
      });
  }
})();
