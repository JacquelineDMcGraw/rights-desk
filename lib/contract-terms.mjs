const maxFieldLength = 8000;
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const usageHeading = /^(?:grant of (?:license|rights)|licen[cs]e grant|scope of (?:the )?licen[cs]e|permitted uses?|usage rights|rights granted|restrictions on use|usage restrictions|limitations on use)\b/i;
const scopeHeading = /^(?:term and territory|territory|duration|term(?: of (?:use|the licen[cs]e))?|attribution|credits?|approved channels|translation rights|sublicen[cs]ing|exclusivity|permitted media|distribution)\s*(?:[.:–—-]|$)/i;
const grantWords = /\b(?:grants?|granted|licen[cs](?:es|ed)|licen[cs]e to|permission to|permits?|permitted|authori[sz](?:es?|ed)|agreed to|may|allowed|shall not|may not|must not|cannot|prohibit(?:s|ed)?|excluded|does not include|not included|(?:isn|aren)[’']t included)\b/i;
const useWords = /\b(?:works?|artwork|content|photographs?|photos?|images?|recordings?|illustrations?|manuscript|footage|reproduc\w*|display|publish|distribut\w*|advertis\w*|paid ads?|websites?|social media|brochures?|sublicen[cs]\w*|translat\w*|commercial use|editorial use)\b/i;
const licenseWords = /\b(?:licen[cs]e|licen[cs]or|licen[cs]ee|permission|usage rights)\b/i;
const scopeWords = /\b(?:territory|ends?|expires?|expiration|attribution|credit line|duration|exclusive|exclusivity|nonexclusive|sublicen[cs]\w*|translations?|worldwide|within the united states)\b/i;
const restrictionWords = /\b(?:only|must|exclud\w*|prohibit\w*|without|no|not|requires?|subject to)\b/i;
const retainedRights = /\b(?:retains?|reserves?)\b[^.!?\n]{0,75}\b(?:copyright|ownership|rights in the work)\b/i;
const creditRequirement = /^(?:please\s+)?credit\s+\S|\b(?:must|shall) (?:provide\s+)?(?:credit|attribution)\b/i;

function withoutNumber(text) {
  return text.replace(/^(?:(?:section|article)\s+)?\d+(?:\.\d+)*[.):-]?\s+/i, '');
}

function pageSections(text) {
  const sections = [];
  let lines = [];
  const flush = () => {
    if (lines.length) sections.push(lines.join('\n'));
    lines = [];
  };
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = withoutNumber(line);
    const nextSection = heading !== line || usageHeading.test(heading) || scopeHeading.test(heading);
    if (nextSection) flush();
    lines.push(line);
  }
  flush();
  return sections;
}

function pageExcerpts(text) {
  const excerpts = [];
  for (const section of pageSections(text)) {
    const heading = withoutNumber(section.split('\n', 1)[0]);
    const namedUsage = heading.match(usageHeading);
    const namedScope = heading.match(scopeHeading);
    const prefix = namedUsage?.[0] || namedScope?.[0];
    const body = prefix && withoutNumber(section).slice(prefix.length).replace(/^[\s.:–—-]+/, '');
    if (body && section.length >= 20 && section.length <= 1200) {
      excerpts.push({ text: section, usage: Boolean(namedUsage) });
      continue;
    }
    for (const { segment } of sentences.segment(section)) {
      const clause = segment.trim();
      if (clause.length < 12) continue;
      const usage = grantWords.test(clause) && useWords.test(clause);
      const scope = (licenseWords.test(clause) && scopeWords.test(clause)) || (useWords.test(clause) && scopeWords.test(clause) && restrictionWords.test(clause)) || retainedRights.test(clause) || creditRequirement.test(clause);
      if (!usage && !scope) continue;
      excerpts.push({ text: clause, usage });
    }
  }
  return excerpts;
}

/** Select source passages without rewriting the wording or supplying missing terms. */
export function suggestContractTerms(pages) {
  const candidates = pages.flatMap(page => pageExcerpts(page.text).map(excerpt => ({ ...excerpt, page: page.page })));
  const accepted = new Set();
  let length = 0;
  for (const excerpt of [...candidates.filter(clause => clause.usage), ...candidates.filter(clause => !clause.usage)]) {
    const nextLength = length + excerpt.text.length + (accepted.size ? 2 : 0);
    if (nextLength > maxFieldLength) continue;
    accepted.add(excerpt);
    length = nextLength;
  }
  const selected = candidates.filter(excerpt => accepted.has(excerpt));
  if (!selected.some(excerpt => excerpt.usage)) {
    const error = new Error('No clear usage terms were found. Review the contract and paste the relevant wording into Existing permission.');
    error.code = 'CONTRACT_NO_TERMS';
    throw error;
  }
  const excerpts = selected.map(({ page, text }) => ({ page, text }));
  return { text: excerpts.map(excerpt => excerpt.text).join('\n\n'), excerpts, method: 'contract-excerpts' };
}
