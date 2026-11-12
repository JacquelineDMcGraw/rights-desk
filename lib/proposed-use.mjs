const maxRequestLength = 4000;
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const useHeading = /^(?:proposed uses?|requested uses?|intended uses?|usage(?: request| scope)?|licen[cs]ing request|placements?|channels?|deliverables?|distribution|media plan)\s*(?:[:.–—-]|$)/i;
const detailHeading = /^(?:duration|timing|campaign dates|schedule|territory|geography|target markets?|target audience|audience|languages?|translations?|quantity|print run|credit|attribution|restrictions?|exclusions?|approval)\s*(?:[:.–—-]|$)/i;
const requestWords = /\b(?:could we|can we|may we|would you|would like|want to|hope to|plan to|looking to|request(?:ing)?|permission to|intend to|our proposal)\b|\bwe[’']d like\b/i;
const actions = /\b(?:us(?:e|es|ing)|reus\w*|licen[cs]\w*|featur\w*|includ\w*|display\w*|publish\w*|show\w*|reproduc\w*|post\w*|print\w*|distribut\w*|advertis\w*|promot\w*|translat\w*|adapt\w*|crop\w*|run|ran|appear\w*|share\w*)\b/i;
const media = /\b(?:paid (?:ads?|social|media)|ad campaigns?|advertis\w*|social media|instagram|facebook|tiktok|youtube|linkedin|website|landing pages?|newsletters?|emails? blasts?|brochures?|flyers?|print runs?|posters?|billboards?|packaging|product pages?|broadcast|press releases?|trade shows?|galler(?:y|ies)|exhibitions?)\b/i;
const work = /\b(?:your work|the work|artwork|photographs?|photos?|images?|illustrations?|recordings?|footage|manuscripts?|designs?|portraits?|video|logo|licensed material)\b/i;
const dateOrDuration = /\b(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:days?|weeks?|months?|years?)|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const locationOrAudience = /\b(?:united states|u\.s|usa|u\.k|united kingdom|canada|worldwide|global|international|local audiences?|territor(?:y|ies)|target audiences?|target markets?|distribution)\b/i;
const conditions = /\b(?:only|excluded|no|without|restricted|limited|must|will credit|attribution|in writing|approved|approval|translation|language|sublicen[cs]\w*|exclusiv\w*|print run|copies)\b/i;
const unrelated = /^(?:from|to|cc|date|sent|subject|reply-to)\s*:|\b(?:invoices?|bank details|payment instructions|payment is due)\b/i;
const oldThread = /^(?:[-_ ]*(?:original|forwarded) message[-_ :]*|on .+ wrote:)/i;
const otherHeading = /^(?:invoice|payment|budget|billing|contact|assets?)\s*(?:[:.–—-]|$)/i;

function withoutBullet(line) {
  return line.replace(/^(?:[•*\-]|\d+[.)])\s+/, '');
}

function sectionsForPage(text) {
  const sections = [];
  let lines = [];
  const flush = () => {
    if (lines.length) sections.push(lines.join('\n'));
    lines = [];
  };
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (oldThread.test(line)) break;
    if (!line || /^>/.test(line) || /^(?:--|thanks[,]?|thank you[,]?|best(?: regards)?[,]?|regards[,]?)$/i.test(line)) { flush(); continue; }
    const heading = withoutBullet(line);
    if (heading !== line || useHeading.test(heading) || detailHeading.test(heading) || otherHeading.test(heading)) flush();
    lines.push(line);
  }
  flush();
  return sections;
}

function pageCandidates(text) {
  const candidates = [];
  for (const section of sectionsForPage(text)) {
    const heading = withoutBullet(section.split('\n', 1)[0]);
    if (otherHeading.test(heading)) continue;
    const useLabel = heading.match(useHeading)?.[0];
    const detailLabel = heading.match(detailHeading)?.[0];
    const label = useLabel || detailLabel;
    const body = label && withoutBullet(section).slice(label.length).replace(/^[\s.:–—-]+/, '');
    if (body && section.length <= 1200) {
      candidates.push({ text: section, primary: Boolean(useLabel) });
      continue;
    }
    for (const { segment } of sentences.segment(section)) {
      const clause = segment.trim();
      if (clause.length < 8 || unrelated.test(clause)) continue;
      const primary = actions.test(clause) && (media.test(clause) || work.test(clause) || requestWords.test(clause) && /\b(?:it|this|them)\b/i.test(clause));
      const geographicScope = locationOrAudience.test(clause) || /\b(?:US|UK)\b/.test(clause);
      const detail = (conditions.test(clause) && (media.test(clause) || work.test(clause) || geographicScope))
        || /\b(?:translations?|sublicen[cs]\w*|attribution|credit line)\b/i.test(clause)
        || (dateOrDuration.test(clause) && (/\b(?:campaign|run|launch|from|for|through|until)\b/i.test(clause) || clause.length < 25));
      if (primary || detail) candidates.push({ text: clause, primary });
    }
  }
  return candidates;
}

/** Return source wording for the proposed use and stated scope, in document order. */
export function suggestProposedUse(pages) {
  const candidates = pages.flatMap(({ page, text }) => pageCandidates(text).map(candidate => ({ ...candidate, page })));
  const included = new Set();
  let length = 0;
  for (const excerpt of [...candidates.filter(candidate => candidate.primary), ...candidates.filter(candidate => !candidate.primary)]) {
    const nextLength = length + excerpt.text.length + (included.size ? 2 : 0);
    if (nextLength > maxRequestLength) continue;
    included.add(excerpt);
    length = nextLength;
  }
  const selected = candidates.filter(candidate => included.has(candidate));
  if (!selected.some(candidate => candidate.primary)) {
    const error = new Error('No clear proposed use was found. Copy the studio’s request into Proposed use.');
    error.code = 'PROPOSED_USE_NO_TERMS';
    throw error;
  }
  const excerpts = selected.map(({ page, text }) => ({ page, text }));
  return { text: excerpts.map(excerpt => excerpt.text).join('\n\n'), excerpts, method: 'proposed-use-excerpts' };
}
