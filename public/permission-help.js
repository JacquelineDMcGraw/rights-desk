const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
);

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? escapeHtml(url.href)
      : '';
  } catch {
    return '';
  }
}

function renderOffice(office) {
  const name = escapeHtml(office.name);
  const website = externalUrl(office.website);
  const map = externalUrl(office.mapUrl);
  const distance = Number.isFinite(office.distanceMiles) && office.distanceMiles >= 0
    ? `<small>${office.distanceMiles < 0.1 ? 'Less than 0.1 mi' : `About ${office.distanceMiles.toFixed(1)} mi`} from ZIP center</small>`
    : '';
  return `<li class="legal-office">
    <p><strong>${name}</strong></p>
    ${office.address ? `<p>${escapeHtml(office.address)}</p>` : ''}
    ${distance}
    ${office.specialty ? `<p class="legal-office-specialty">${escapeHtml(office.specialty)} listed as a practice area</p>` : ''}
    ${website || map ? `<div class="legal-office-links">
      ${website ? `<a href="${website}" target="_blank" rel="noopener noreferrer" aria-label="Website for ${name}">Website</a>` : ''}
      ${map ? `<a href="${map}" target="_blank" rel="noopener noreferrer" aria-label="Map for ${name}">View on map</a>` : ''}
    </div>` : ''}
  </li>`;
}

export function installLegalHelpLookup(root = document) {
  const pending = new WeakMap();
  root.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches?.('[data-legal-help-lookup]')) return;
    event.preventDefault();

    const zip = form.elements.zip.value.trim();
    const status = form.querySelector('[data-legal-help-status]');
    const results = form.querySelector('[data-legal-help-results]');
    if (!/^[0-9]{5}$/.test(zip)) {
      status.textContent = 'Enter a 5-digit U.S. ZIP code.';
      return;
    }

    pending.get(form)?.abort();
    const request = new AbortController();
    pending.set(form, request);
    status.textContent = 'Looking for law offices near this ZIP code…';
    results.replaceChildren();
    results.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`/api/legal-help?zip=${encodeURIComponent(zip)}`, { signal: request.signal });
      if (pending.get(form) !== request || !form.isConnected) return;
      if (response.status === 404) {
        status.textContent = 'We couldn’t find that ZIP code. Check it or use the lawyer directories below.';
        return;
      }
      if (!response.ok) throw new Error('Law office lookup unavailable');
      const data = await response.json();
      if (pending.get(form) !== request || !form.isConnected) return;
      if (!Array.isArray(data.offices)) throw new Error('Law office lookup unavailable');
      const offices = data.offices.filter(office => typeof office?.name === 'string' && office.name.trim());
      const location = [data.place, data.region].filter(Boolean).join(', ') || zip;
      if (!offices.length) {
        status.textContent = data.lookupIncomplete
          ? `We found ${location}, but couldn’t load nearby offices. Try the lawyer directories below.`
          : `We didn’t find law offices near ${location} in the map listings. Try the lawyer directories below.`;
        return;
      }
      status.textContent = `${offices.length} ${offices.length === 1 ? 'law office' : 'law offices'} near ${location}.`;
      results.innerHTML = `<p class="legal-help-match-note">Ask the office whether it handles copyright, licensing, or contracts. Check the lawyer’s license with the state bar.</p>
        <ul class="legal-office-list">${offices.map(renderOffice).join('')}</ul>`;
    } catch {
      if (pending.get(form) === request && form.isConnected) {
        status.textContent = 'The ZIP lookup is unavailable right now. Try again or use the lawyer directories below.';
      }
    } finally {
      if (pending.get(form) === request) {
        results.removeAttribute('aria-busy');
        pending.delete(form);
      }
    }
  });
}

export function renderPermissionHelp() {
  return `<details class="permission-help">
    <summary>Find legal &amp; technical help</summary>
    <div class="permission-help-content">
      <p>For creators and people requesting permission. Rights Desk organizes the agreement, proposed use, and records. A qualified professional can assess your rights and obligations in your specific situation.</p>
      <div class="permission-help-section">
        <p class="permission-help-heading"><strong>Find a lawyer near you</strong></p>
        <form data-legal-help-lookup>
          <div class="legal-help-search">
            <label>U.S. ZIP code
              <input name="zip" type="text" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" placeholder="02139" required>
            </label>
            <button class="button outline" type="submit">Find law offices</button>
          </div>
          <p class="legal-help-status" role="status" data-legal-help-status></p>
          <div data-legal-help-results></div>
          <p class="legal-help-source">ZIP data from <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> via <a href="https://www.zippopotam.us/" target="_blank" rel="noopener noreferrer">Zippopotam.us</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.</p>
        </form>
      </div>
      <div class="permission-help-section">
        <p class="permission-help-heading"><strong>Start with the agreement</strong></p>
        <p>Bring the existing license or agreement, any written approvals, the proposed use, and relevant records.</p>
      </div>
      <div class="permission-help-section">
        <p class="permission-help-heading"><strong>Prepare your questions</strong></p>
        <ul>
          <li>Which rights are covered, and who can approve a change?</li>
          <li>How will the work be used, in which formats, and in what locations?</li>
          <li>Who is the intended audience, and how long will the use last?</li>
          <li>What is still unclear or undecided?</li>
        </ul>
      </div>
      <div class="permission-help-section">
        <p class="permission-help-heading"><strong>Choose the help you need</strong></p>
        <ul class="permission-help-links">
          <li><a href="https://www.copyright.gov/help/faq/" target="_blank" rel="noopener noreferrer">
            <span class="permission-help-link-title">Understand copyright</span>
            <span>U.S. Copyright Office explanations of protection, ownership, and permission.</span>
            <small>External site · opens in a new tab</small>
          </a></li>
          <li><a href="https://www.usa.gov/legal-aid" target="_blank" rel="noopener noreferrer">
            <span class="permission-help-link-title">Find a lawyer or legal aid</span>
            <span>USAGov's general legal-help referrals. Eligibility, services, and costs vary; ask whether a provider handles your issue.</span>
            <small>External site · opens in a new tab</small>
          </a></li>
          <li><a href="https://www.americanbar.org/groups/legal_services/flh-home/flh-bar-directories-and-lawyer-finders/" target="_blank" rel="noopener noreferrer">
            <span class="permission-help-link-title">Bar directories and lawyer referrals</span>
            <span>Find your state bar directory or ask a referral service for a lawyer who handles copyright or licensing.</span>
            <small>American Bar Association</small>
          </a></li>
          <li><a href="https://ccb.gov/pro-bono-assistance/" target="_blank" rel="noopener noreferrer">
            <span class="permission-help-link-title">Copyright clinics and pro bono help</span>
            <span>See the Copyright Claims Board’s list of programs and check which services you qualify for.</span>
            <small>Copyright Claims Board</small>
          </a></li>
          <li><a href="https://www.copyright.gov/help/" target="_blank" rel="noopener noreferrer">
            <span class="permission-help-link-title">Registration &amp; technical support</span>
            <span>U.S. Copyright Office contact forms for registration, application, and system questions.</span>
            <small>External site · opens in a new tab</small>
          </a></li>
        </ul>
      </div>
    </div>
  </details>`;
}
