// Issue-spotting prompts, not a finding that any claim exists. A photographer's
// copyright, a subject's likeness/privacy interests, and a license contract
// can belong to different people. Links go to official government sources.
const HELP = 'https://www.usa.gov/legal-aid';
const codes = {
  Alabama: 'https://alison.legislature.state.al.us/code-of-alabama?section=6-5-770',
  Alaska: 'https://www.akleg.gov/basis/statutes.asp',
  Arizona: 'https://www.azleg.gov/arsDetail/?title=12',
  Arkansas: 'https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FACTS%2F2025R%2FPublic%2FACT159.pdf',
  California: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=3344.&lawCode=CIV',
  Colorado: 'https://leg.colorado.gov/agencies/office-legislative-legal-services/colorado-revised-statutes',
  Connecticut: 'https://www.cga.ct.gov/2014/rpt/2014-R-0064.htm',
  Delaware: 'https://delcode.delaware.gov/',
  'District of Columbia': 'https://code.dccouncil.gov/',
  Florida: 'https://www.leg.state.fl.us/STATUTES/index.cfm?App_mode=Display_Statute&URL=0500-0599%2F0540%2FSections%2F0540.08.html',
  Georgia: 'https://www.legis.ga.gov/legislation',
  Hawaii: 'https://data.capitol.hawaii.gov/hrscurrent/Vol11_Ch0476-0490/HRS0482P/HRS_0482P-0001.htm',
  Idaho: 'https://legislature.idaho.gov/statutesrules/idstat/',
  Illinois: 'https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2241&Chapter=PROPERTY&ChapterID=62&MajorTopic=RIGHTS+AND+REMEDIES',
  Indiana: 'https://iga.in.gov/legislative/laws/current/ic/titles/32/',
  Iowa: 'https://www.legis.iowa.gov/law',
  Kansas: 'https://www.kslegislature.gov/li/b2025_26/statute/',
  Kentucky: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=36149',
  Louisiana: 'https://legis.la.gov/legis/LawPrint.aspx?d=1295749',
  Maine: 'https://legislature.maine.gov/legis/statutes/search.htm',
  Maryland: 'https://mgaleg.maryland.gov/mgawebsite/Laws/Statutes',
  Massachusetts: 'https://malegislature.gov/Laws/GeneralLaws/PartIII/TitleI/Chapter214/Section3A',
  Michigan: 'https://www.legislature.mi.gov/Laws/MCL',
  Minnesota: 'https://www.revisor.mn.gov/statutes/',
  Mississippi: 'https://www.legislature.ms.gov/',
  Missouri: 'https://www.revisor.mo.gov/main/Home.aspx',
};

// Use a narrow statement when the cited law identifies one. Otherwise request
// a local check instead of inferring that a general publicity statute exists.
const specifics = {
  Alabama: {
    publicity: ['The Alabama Right of Publicity Act recognizes control of identifying attributes, including a photograph, for commercial uses and lists exceptions. A depicted person’s claim is separate from the image creator’s copyright.', codes.Alabama],
  },
  Arizona: {
    publicity: ['A.R.S. § 12-761 provides a specific commercial name/portrait/picture remedy for soldiers; other people need a separate common-law review.', 'https://www.azleg.gov/ars/12/00761.htm'],
    privacy: ['A.R.S. § 12-741 provides a civil remedy for certain nonconsensual disclosures or threatened disclosures of private intimate images. Ordinary reuse of a photo does not by itself meet those elements.', 'https://www.azleg.gov/ars/12/00741.htm'],
  },
  Arkansas: {
    publicity: ['The Frank Broyles Publicity Rights Protection Act covers specified unauthorized commercial uses of a person’s identity. A 2025 amendment expressly addresses AI-reproduced photograph, voice, or likeness; check consent, definitions, and exceptions.', codes.Arkansas],
  },
  California: {
    publicity: ['Civil Code § 3344 addresses knowing use of a person’s name, voice, signature, photograph, or likeness in products or advertising without prior consent. The statute has express limits and exceptions.', codes.California],
    privacy: ['A likeness claim under § 3344 concerns the depicted person and commercial use; it does not follow automatically from copying the photographer’s image. Evaluate any separate privacy facts.', codes.California],
  },
  Colorado: {
    publicity: ['Colorado’s Supreme Court recognizes a privacy claim for appropriation of a person’s name, likeness, or identity. The judicial instruction describes personal damages and leaves commercial-value damages unresolved.', 'https://www.coloradojudicial.gov/media/13687'],
    privacy: ['Colorado’s appropriation theory is one privacy tort; the context, consent, newsworthiness, and type of harm can change the result.', 'https://www.coloradojudicial.gov/media/13687'],
  },
  Connecticut: {
    publicity: ['Connecticut recognizes appropriation of another’s name or likeness as a common-law invasion-of-privacy theory; investigate consent and the actual benefit or use.', codes.Connecticut],
    privacy: ['Connecticut’s recognized privacy torts also include intrusion, private-fact publicity, and false light. Each needs facts beyond an image match.', codes.Connecticut],
  },
  Delaware: {
    publicity: ['Delaware’s civil jury instructions describe appropriation of another person’s name or likeness for one’s own use or benefit as an invasion-of-privacy theory.', 'https://www.courts.delaware.gov/forms/download.aspx?id=85928'],
    privacy: ['Delaware’s jury instructions separately describe intrusion, appropriation, publication of private facts, and false light; identify which theory the facts could support.', 'https://www.courts.delaware.gov/forms/download.aspx?id=85928'],
  },
  'District of Columbia': {
    privacy: ['D.C. Code § 7-2162 gives a depicted person a civil route for certain nonconsensual private intimate-image disclosures. It is distinct from an ordinary copyright dispute.', 'https://code.dccouncil.gov/us/dc/council/code/sections/7-2162'],
  },
  Florida: {
    publicity: ['Florida Statutes § 540.08 restricts public use of a natural person’s name, portrait, photograph, or likeness for trade, commercial, or advertising purposes without the required consent; exceptions and context matter.', codes.Florida],
  },
  Hawaii: {
    publicity: ['Hawaii Revised Statutes chapter 482P defines publicity rights in identifying attributes, including recognizable likenesses. Review the commercial-use rule and exemptions before alleging a violation.', codes.Hawaii],
  },
  Illinois: {
    publicity: ['The Illinois Right of Publicity Act recognizes an individual’s choice over commercial use of identity. The Act expressly excludes some news, expressive, and other uses.', codes.Illinois],
    contract: ['The Illinois Act permits written transfer of publicity rights; inspect the release or license and who currently holds the identity right.', codes.Illinois],
  },
  Indiana: {
    publicity: ['Indiana Code 32-36-1 requires consent for specified commercial uses of a personality’s publicity right and defines exceptions. The person whose identity is used may differ from the copyright owner.', codes.Indiana],
  },
  Iowa: {
    publicity: ['Iowa’s privacy case law recognizes appropriation of a person’s name or likeness for another’s benefit. Whether that theory fits needs a local case-law review.', 'https://www.legis.iowa.gov/docs/publications/AGO/1043261.pdf'],
  },
  Kentucky: {
    publicity: ['KRS § 391.170 recognizes commercial rights in a person’s name and likeness and restricts commercial-profit use of a deceased public figure’s identity for 50 years without estate consent.', codes.Kentucky],
  },
  Louisiana: {
    publicity: ['La. R.S. 51:470.3 recognizes a property interest in commercial use of an individual’s identity. Check the chapter’s coverage, exemptions, and the rights holder.', codes.Louisiana],
    contract: ['La. R.S. 51:470.3 requires a signed writing for a transfer or exclusive license of identity rights; a photograph license is a separate document to inspect.', codes.Louisiana],
  },
  Massachusetts: {
    publicity: ['Mass. Gen. Laws ch. 214, § 3A permits a person to sue over use of their name, portrait, or picture in Massachusetts advertising or trade without written consent, subject to statutory limits.', codes.Massachusetts],
  },
};

function entry(name) {
  const source = codes[name];
  const specific = specifics[name] || {};
  const field = ([summary, sourceUrl]) => ({summary, sourceUrl});
  return {
    name,
    publicity: field(specific.publicity || [`Local review needed in ${name}: check whether the depicted person has a commercial identity or appropriation claim. The photographer’s copyright alone does not establish it.`, source]),
    privacy: field(specific.privacy || [`Local review needed in ${name}: identify the depicted person, consent, private setting or facts, and type of disclosure. A matching image alone does not establish a privacy claim.`, source]),
    contract: field(specific.contract || [`Local review needed in ${name}: compare signed assignments, commissioned-work terms, model releases, and licenses against the actual use and parties.`, source]),
    helpUrl: HELP,
    asOf: '2026-10-25',
  };
}

export const JURISDICTIONS_A = Object.fromEntries(Object.keys(codes).map(name => [name, entry(name)]));
