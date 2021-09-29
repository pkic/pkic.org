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
  })()