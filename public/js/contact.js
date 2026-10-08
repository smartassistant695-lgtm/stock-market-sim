// Contact Us form: sends the message to /api/save, which adds it to the
// "Contact" tab of the Google Sheet.

(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  var status = document.getElementById('c-status');
  var button = document.getElementById('c-send');

  function show(text, bad) {
    status.textContent = text;
    status.className = 'contact-status' + (bad ? ' bad' : '');
  }

  // Marks a field red when it is empty or wrong. Returns true when it is fine.
  function check(input, ok) {
    input.closest('.field').classList.toggle('invalid', !ok);
    return ok;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = document.getElementById('c-name');
    var email = document.getElementById('c-email');
    var message = document.getElementById('c-message');

    var good = [
      check(name, name.value.trim().length > 0),
      check(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())),
      check(message, message.value.trim().length > 0),
    ].every(Boolean);
    if (!good) {
      show('Please fill in your name, a valid email and a message.', true);
      return;
    }

    // A robot filled in the hidden field: act as if it worked, send nothing.
    if (document.getElementById('c-website').value) {
      form.reset();
      show('Thank you. Your message was sent.');
      return;
    }

    button.disabled = true;
    show('Sending...');
    fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: 'Contact',
        batchId: 'contact-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        rows: [{
          timestamp: new Date().toISOString(),
          name: name.value.trim(),
          email: email.value.trim(),
          message: message.value.trim(),
        }],
      }),
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (data) {
        if (data.ok) {
          form.reset();
          show('Thank you. Your message was sent.');
        } else {
          show('Sorry, the message could not be sent. Please try again later.', true);
        }
      })
      .catch(function () {
        show('Sorry, the message could not be sent. Check the internet connection and try again.', true);
      })
      .then(function () { button.disabled = false; });
  });
})();
