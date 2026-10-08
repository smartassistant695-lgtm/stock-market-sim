// Footer for every page (except test.html).
// Each page ends with <footer id="site-footer" data-page="Page name"></footer>
// followed by this script, which fills the footer in.

(function () {
  'use strict';

  // ==================================================================
  //  EDIT THE FOOTER TEXT HERE
  //  Words in {curly brackets} are filled in from the first lines, so
  //  for example the year only needs to be changed once.
  //  An item with a "link" becomes a link; without one it is plain text.
  // ==================================================================
  const FOOTER = {
    names: 'Noah and Jojo',          // {names}
    shortName: 'Noah & Jojo',        // first item of the "Noah & Jojo › Page" row
    school: '[John L. Miller Great Neck North Highschool]',         // {school}
    email: '[skaya1@student.gn.k12.ny.us or Johebshalom5@student.gn.k12.ny.us]',           // becomes a link once it contains an @
    year: '2026',                    // {year}
    photographer: 'Jamal Eid / NYSE', // {photographer}: also edit the credit in index.html
    photoLink: '#',                  // {photoLink}: the web page of the photo (# = no link yet)

    note: 'All trading on this website is simulated with virtual money. ' +
      'Market data from Alpaca may be delayed 15 minutes. Nothing here is financial advice.',

    columns: [
      {
        heading: 'Explore',
        items: [
          { text: 'Home', link: 'index.html' },
          { text: 'Simulation', link: 'simulation.html' },
          { text: 'Market Data', link: 'market.html' },
          { text: 'About Us', link: 'about.html' },
          { text: 'Contact Us', link: 'contact.html' },
        ],
      },
      {
        heading: 'Credits',
        items: [
          { text: 'Photo: {photographer}, used with permission', link: '{photoLink}' },
          { text: 'Charts: TradingView Lightweight Charts™', link: 'https://www.tradingview.com/' },
          { text: 'Market data: Alpaca', link: 'https://alpaca.markets/' },
          { text: 'Typeface: Cormorant Garamond' },
        ],
      },
      {
        heading: 'Researchers',
        items: [
          { text: 'Noah' },
          { text: 'Jojo' },
          { text: '{school}' },
        ],
      },
    ],

    contact: 'Questions about the study? Contact {names} at {email}.',

    copyright: 'Copyright © {year} {names}. All rights reserved.',
    legal: [
      // Keep this notice and link: the chart library's license asks for it.
      { text: 'Lightweight Charts™ © 2025 TradingView, Inc.', link: 'https://www.tradingview.com/' },
      // The researcher's way into researcher.html (not in the navigation).
      { text: 'Researcher', link: 'researcher.html' },
    ],
    right: 'Science Research {year}',
  };
  // ======================= END OF FOOTER TEXT =======================

  const footer = document.getElementById('site-footer');
  if (!footer) return;

  // Replaces {names}, {year} and so on with the values above.
  function fill(text) {
    return String(text).replace(/\{(\w+)\}/g, (whole, key) =>
      typeof FOOTER[key] === 'string' ? FOOTER[key] : whole
    );
  }

  // Makes an element with a class and text (textContent, so no HTML is ever inserted).
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // A link, or plain text when there is no real address yet.
  function item(text, link) {
    const href = link ? fill(link) : '';
    if (!href || href === '#') return make('span', '', fill(text));
    const a = make('a', '', fill(text));
    a.href = href;
    if (/^https?:/.test(href)) {
      a.target = '_blank';   // other websites open in a new tab
      a.rel = 'noopener';
    }
    return a;
  }

  // The contact sentence, with the email as a link when it is a real address.
  function contactLine() {
    const p = make('p', 'footer-contact');
    const parts = FOOTER.contact.split('{email}');
    p.append(fill(parts[0]));
    if (parts.length > 1) {
      if (FOOTER.email.includes('@')) {
        const a = make('a', '', FOOTER.email);
        a.href = 'mailto:' + FOOTER.email;
        p.append(a);
      } else {
        p.append(FOOTER.email);
      }
      p.append(fill(parts.slice(1).join('{email}')));
    }
    return p;
  }

  const inner = make('div', 'footer-inner');

  // a) Note line
  inner.append(make('p', 'footer-note', fill(FOOTER.note)));

  // b) "Noah & Jojo › Page name"
  const crumbs = make('nav', 'footer-breadcrumb');
  crumbs.setAttribute('aria-label', 'Breadcrumb');
  const home = make('a', '', FOOTER.shortName);
  home.href = 'index.html';
  const chevron = make('span', 'footer-chevron', '›');
  chevron.setAttribute('aria-hidden', 'true');
  const current = make('span', '', footer.dataset.page || '');
  current.setAttribute('aria-current', 'page');
  crumbs.append(home, chevron, current);
  inner.append(crumbs);

  // c) Link columns
  const columns = make('div', 'footer-columns');
  FOOTER.columns.forEach((column) => {
    const col = make('div', 'footer-col');
    col.append(make('h2', 'footer-heading', fill(column.heading)));
    const list = make('ul');
    column.items.forEach((entry) => {
      const li = make('li');
      li.append(item(entry.text, entry.link));
      list.append(li);
    });
    col.append(list);
    columns.append(col);
  });
  inner.append(columns);

  // d) Contact line
  inner.append(contactLine());

  // e) Copyright and notices
  const legal = make('div', 'footer-legal');
  const legalLeft = make('div', 'footer-legal-left');
  const legalList = make('ul', 'footer-legal-list');
  FOOTER.legal.forEach((entry) => {
    const li = make('li');
    li.append(item(entry.text, entry.link));
    legalList.append(li);
  });
  legalLeft.append(make('p', 'footer-copyright', fill(FOOTER.copyright)), legalList);
  legal.append(legalLeft, make('p', 'footer-right', fill(FOOTER.right)));
  inner.append(legal);

  footer.classList.add('site-footer'); // the experiment hides .site-footer during a session
  footer.replaceChildren(inner);
})();
