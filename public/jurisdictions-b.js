// Jurisdiction prompts for issue spotting, not a determination that a claim exists.
// An image copyright claim, a depicted person's likeness claim, and a license dispute
// may belong to different people. Source URLs point to official law or court resources.
const HELP = 'https://www.usa.gov/legal-aid';
const COPYRIGHT_TERRITORIES = 'https://www.copyright.gov/circs/circ38a.pdf';
const OUTLYING_VENUE = 'https://usc-cdn.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title48-section644a';

const stateCodes = {
  Montana: 'https://leg.mt.gov/bills/mca/',
  Nebraska: 'https://www.nebraskalegislature.gov/laws/browse-chapters.php?chapter=20',
  Nevada: 'https://www.leg.state.nv.us/NRS/NRS-597.html',
  'New Hampshire': 'https://www.gencourt.state.nh.us/rsa/html/',
  'New Jersey': 'https://www.njcourts.gov/courts/supreme',
  'New Mexico': 'https://nmonesource.com/nmos/nmsa/en/nav_date.do',
  'New York': 'https://www.nysenate.gov/legislation/laws/CVR/51',
  'North Carolina': 'https://www.ncleg.gov/Laws/GeneralStatutes',
  'North Dakota': 'https://ndlegis.gov/cencode/',
  Ohio: 'https://codes.ohio.gov/ohio-revised-code/chapter-2741',
  Oklahoma: 'https://oksenate.gov/oklahoma-statutes',
  Oregon: 'https://www.oregonlegislature.gov/bills_laws/Pages/ORS.aspx',
  Pennsylvania: 'https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/42/00.083.016.000..HTM',
  'Rhode Island': 'https://webserver.rilegislature.gov/Statutes/TITLE9/9-1/9-1-28.1.htm',
  'South Carolina': 'https://www.scstatehouse.gov/code/statmast.php',
  'South Dakota': 'https://sdlegislature.gov/Statutes/21-64',
  Tennessee: 'https://wapp.capitol.tn.gov/apps/BillInfo/Default?BillNumber=HB2091&ga=113',
  Texas: 'https://statutes.capitol.texas.gov/Docs/PR/htm/PR.26.htm',
  Utah: 'https://le.utah.gov/xcode/code.html',
  Vermont: 'https://legislature.vermont.gov/statutes/',
  Virginia: 'https://law.lis.virginia.gov/vacode/title8.01/chapter3/section8.01-40/',
  Washington: 'https://lawfilesext.leg.wa.gov/law/RCW/RCW%20%2063%20%20TITLE/RCW%20%2063%20.%2060%20%20CHAPTER/RCW%20%2063%20.%2060%20.050.htm',
  'West Virginia': 'https://code.wvlegislature.gov/',
  Wisconsin: 'https://docs.legis.wisconsin.gov/statutes/statutes/995/50',
  Wyoming: 'https://www.wyoleg.gov/statutes/compress/title01.pdf',
};

const stateSpecific = {
  'New Hampshire': {
    publicity: ['New Hampshire Supreme Court decisions recognize appropriation of another person’s name or likeness as a privacy theory. Check the actual use, consent, and benefit before asserting it.', 'https://www.courts.nh.gov/sites/g/files/ehbemt471/files/documents/2024-09/2024049richards.pdf'],
    privacy: ['New Hampshire also recognizes distinct intrusion and private-fact privacy theories; an image match alone does not establish their separate elements.', 'https://www.courts.nh.gov/sites/g/files/ehbemt471/files/documents/2024-09/2024049richards.pdf'],
    contract: ['A New Hampshire Supreme Court opinion explains that an authorized license can defeat an appropriation theory. Compare the actual release or license scope with the disputed use.', 'https://www.courts.nh.gov/sites/g/files/ehbemt471/files/documents/2022-03/thomp041.pdf'],
  },
  'New Jersey': {
    publicity: ['New Jersey courts describe appropriation of a person’s name or likeness for another’s benefit as a distinct invasion-of-privacy theory; consent and commercial context matter.', 'https://www.njcourts.gov/system/files/court-opinions/2023/a1596-21.pdf'],
    privacy: ['New Jersey’s courts distinguish appropriation, intrusion, public disclosure of private facts, and false light; identify the theory supported by the facts.', 'https://www.njcourts.gov/sites/default/files/charges/3.14.pdf'],
  },
  'New Mexico': {
    publicity: ['A New Mexico appellate decision addresses appropriation of a person’s name or likeness but leaves a related limitations-period question unresolved. Get case-specific advice before relying on the theory.', 'https://coa.nmcourts.gov/wp-content/uploads/sites/43/2024/01/December-11-2019-Veronica-Vigil-v.-Anne-Taintor-No.-A-1-CA-36634.pdf'],
  },
  'North Carolina': {
    publicity: ['North Carolina courts recognize a narrow claim for unauthorized appropriation of a person’s photographic likeness in an advertisement or commercial enterprise. A creator’s separate copyright claim needs its own analysis.', 'https://www.nccourts.gov/assets/documents/pdf-volumes/nccoa123.pdf?VersionId=xGvB0T6f6A8EhcQhlXFZvC8JIHidoWe3'],
    privacy: ['North Carolina General Statutes § 14-190.5A gives the depicted person a specific civil route for certain nonconsensual intimate-image disclosures, including realistic AI alterations; ordinary reuse does not meet that rule automatically.', 'https://library.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_14/GS_14-190.5A.html'],
  },
  'North Dakota': {
    privacy: ['North Dakota Century Code chapter 32-49 provides a civil claim for a narrowly defined nonconsensual disclosure of an intimate image. It is not a general remedy for every reused photograph.', 'https://ndlegis.gov/cencode/t32c49.pdf'],
  },
  Nebraska: {
    publicity: ['Neb. Rev. Stat. § 20-202 treats commercial exploitation of a person’s name or likeness as invasion of privacy, subject to stated exceptions.', stateCodes.Nebraska],
    privacy: ['Neb. Rev. Stat. §§ 20-203–204 also address offensive intrusion and false light; consent and public-interest defenses matter.', stateCodes.Nebraska],
  },
  Nevada: {
    publicity: ['NRS 597.790 protects a person’s name, voice, signature, photograph, or likeness in commercial use; written consent and exceptions matter.', stateCodes.Nevada],
  },
  'New York': {
    publicity: ['Civil Rights Law §§ 50–51 cover use of a living person’s name, portrait, picture, likeness, or voice in ads or trade without written consent.', 'https://www.nysenate.gov/legislation/laws/CVR/51'],
    privacy: ['The § 51 remedy is tied to advertising or trade use; a photograph’s copyright and the depicted person’s rights are separate questions.', 'https://www.nysenate.gov/legislation/laws/CVR/51'],
  },
  Oklahoma: {
    publicity: ['Okla. Stat. tit. 12, § 1449 addresses knowing, unconsented use of an identifiable person’s name, voice, signature, photograph, or likeness on goods or in advertising and sales. News, public-affairs, sports, and political uses are treated differently.', 'https://oklegislature.gov/OK_Statutes/CompleteTitles/os12.pdf'],
  },
  Oregon: {
    privacy: ['ORS 30.831 provides a civil claim for specified nonconsensual recording or dissemination of a person in a state of nudity where privacy was expected. Ordinary reuse of a non-intimate image does not meet that rule by itself.', 'https://www.oregonlegislature.gov/bills_laws/ors/ors030.html'],
  },
  Ohio: {
    publicity: ['Ohio Rev. Code Ch. 2741 recognizes a persona right; check statutory exceptions for news, fine art, and other expression.', stateCodes.Ohio],
  },
  Pennsylvania: {
    publicity: ['42 Pa.C.S. § 8316 allows claims for unauthorized commercial or advertising use of a natural person’s name or likeness with commercial value.', stateCodes.Pennsylvania],
  },
  'Rhode Island': {
    publicity: ['R.I. Gen. Laws § 9-1-28.1 covers unpermitted appropriation of a person’s name or likeness for another’s benefit.', stateCodes['Rhode Island']],
    privacy: ['§ 9-1-28.1 also addresses intrusion, private-fact publicity, and false light; each has separate elements.', stateCodes['Rhode Island']],
  },
  'South Dakota': {
    publicity: ['SDCL Ch. 21-64 addresses unauthorized commercial use of a qualifying personality’s name, image, or likeness, with defined permitted uses.', stateCodes['South Dakota']],
  },
  'South Carolina': {
    publicity: ['The South Carolina Supreme Court recognizes wrongful appropriation of personality: intentional, unconsented use of a person’s name, likeness, or identity for another’s benefit. Consent and the specific use matter.', 'https://www.sccourts.org/media/opinions/HTMLFiles/SC/25689.htm'],
    privacy: ['South Carolina recognizes distinct privacy theories for appropriation of personality, publicizing private affairs, and intrusion. An image match alone does not establish any one of them.', 'https://www.sccourts.org/media/opinions/HTMLFiles/SC/25689.htm'],
  },
  Tennessee: {
    publicity: ['Tennessee’s ELVIS Act amended personal-rights protection for name, photograph, voice, and likeness, including identifiable voice simulations.', stateCodes.Tennessee],
  },
  Texas: {
    publicity: ['Texas Property Code Ch. 26 addresses a deceased individual’s commercially valuable name or likeness; living-person claims need separate review.', stateCodes.Texas],
  },
  Utah: {
    publicity: ['Utah Code Title 45, Ch. 3 covers unconsented commercial uses of personal identity, including certain artificial recreations. Review the current statute’s consent rules and expressive-use exceptions.', 'https://le.utah.gov/xcode/Title45/Chapter3/C45-3_1800010118000101.pdf'],
  },
  Vermont: {
    privacy: ['13 V.S.A. § 2606 provides a narrow civil action for harmful, nonconsensual disclosure of an identifiable nude or sexual image. Consent to making an image alone is not consent to disclosure; ordinary image reuse requires a different analysis.', 'https://legislature.vermont.gov/statutes/section/13/059/02606'],
  },
  Virginia: {
    publicity: ['Va. Code § 8.01-40 allows suit over use of name, portrait, picture, voice, or likeness for advertising or trade without written consent.', stateCodes.Virginia],
  },
  Washington: {
    publicity: ['RCW 63.60.050 covers unconsented commercial use of name, voice, photograph, likeness, or forged digital likeness; exceptions apply.', stateCodes.Washington],
    contract: ['RCW 63.60.030 permits personality rights to be transferred or licensed; check the actual grant before asserting control.', 'https://lawfilesext.leg.wa.gov/law/RCW/RCW%20%2063%20%20TITLE/RCW%20%2063%20.%2060%20%20CHAPTER/RCW%20%2063%20.%2060%20.030.htm'],
  },
  'West Virginia': {
    publicity: ['West Virginia treats appropriation of a person’s name or likeness as a privacy tort. Mere publication is insufficient; the user must take the value of the person’s identity for their own benefit.', 'https://www.courtswv.gov/sites/default/pubfilesmnt/2023-08/22-0057-md.pdf'],
    privacy: ['The West Virginia Supreme Court recognizes separate privacy theories for intrusion, appropriation, private-fact publicity, and false light. Newsworthiness and consent may matter.', 'https://www.courtswv.gov/sites/default/pubfilesmnt/2023-12/14-0679.pdf'],
  },
  Wisconsin: {
    publicity: ['Wis. Stat. § 995.50 addresses use of a person’s name, portrait, or picture for advertising or trade without written consent.', stateCodes.Wisconsin],
  },
  Wyoming: {
    privacy: ['Wyo. Stat. § 6-4-306 makes certain intentional, nonconsensual dissemination of an intimate image a crime, including a computer-generated image purporting to show an identifiable person. It is not a general civil claim for copied photographs.', 'https://www.wyoleg.gov/statutes/compress/title06.pdf'],
  },
};

function makeState(name) {
  const code = stateCodes[name];
  const specific = stateSpecific[name] || {};
  const fallbackPublicity = ['Local review needed; check whether the depicted person has a likeness claim. This differs from the creator’s copyright claim.', code];
  const fallbackPrivacy = ['Local review needed; privacy claims depend on the subject, use, consent, and local law. A copied work alone does not prove one.', code];
  const fallbackContract = ['Local review needed; compare signed licenses, releases, assignments, and work-for-hire terms with the exact disputed use.', code];
  const field = (pair) => ({summary: pair[0], sourceUrl: pair[1]});
  return {
    name,
    publicity: field(specific.publicity || fallbackPublicity),
    privacy: field(specific.privacy || fallbackPrivacy),
    contract: field(specific.contract || fallbackContract),
    helpUrl: HELP,
    asOf: '2026-10-25',
  };
}

const territorySpecific = {
  'Puerto Rico': {
    law: 'https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/139-2011.pdf',
    publicity: 'Puerto Rico’s Law 139-2011 protects a person’s own image against unauthorized commercial use; check its exceptions and later amendments.',
    privacy: 'Puerto Rico’s own-image law is distinct from ownership of the photograph; review local privacy law for a separate claim.',
    contract: 'Local review needed; gather written image releases, copyright assignments, and licenses, then check Puerto Rico law and forum.',
  },
  'U.S. Virgin Islands': {
    law: 'https://www.visuperiorcourt.org/',
    publicity: 'Local review needed; verify any likeness or publicity theory under Virgin Islands law before asserting it.',
    privacy: 'Local review needed; verify consent, context, and any Virgin Islands privacy claim with local counsel.',
    contract: 'Local review needed; collect license and release terms, then verify governing law and forum in the Virgin Islands.',
  },
  Guam: {
    law: 'https://col.guamcourts.gov/guam-code-annotated/guam-code-annotated',
    publicity: 'Local review needed; check Guam’s current code and decisions for any commercial likeness claim.',
    privacy: 'Local review needed; check Guam law for a privacy claim tied to the subject, consent, and how the image was obtained or disclosed. Ordinary copying does not establish one.',
    contract: 'Local review needed; collect releases and licenses and check applicable Guam law before alleging breach.',
  },
  'Northern Mariana Islands': {
    law: 'https://www.cnmilaw.org/',
    publicity: 'Local review needed; verify any likeness claim under current Commonwealth law and decisions.',
    privacy: 'Local review needed; determine whether a Commonwealth privacy rule fits the facts and whether consent applies.',
    contract: 'Local review needed; gather grants and releases, then verify the governing Commonwealth contract rule.',
  },
  'American Samoa': {
    law: COPYRIGHT_TERRITORIES,
    publicity: 'Local review needed; verify any local likeness right. Copyright Office Circular 38A says Title 17 does not apply in American Samoa.',
    privacy: 'Local review needed; confirm the governing privacy rule and forum. Do not assume a mainland remedy applies.',
    contract: 'Local review needed; preserve licenses and obtain American Samoa advice before using a standard U.S. copyright claim route.',
  },
};

function makeTerritory(name) {
  const item = territorySpecific[name];
  return {
    name,
    publicity: {summary:item.publicity, sourceUrl:item.law},
    privacy: {summary:item.privacy, sourceUrl:item.law},
    contract: {summary:item.contract, sourceUrl:item.law},
    helpUrl:HELP,
    asOf:'2026-10-25',
  };
}

const outlying = [
  'Baker Island','Howland Island','Jarvis Island','Johnston Atoll','Kingman Reef',
  'Midway Atoll','Navassa Island','Palmyra Atoll','Wake Island',
];
function makeOutlying(name) {
  const navassa = name === 'Navassa Island';
  const law = navassa ? 'https://www.doi.gov/node/11611' : OUTLYING_VENUE;
  const venue = navassa
    ? 'Navassa has distinct federal administration; verify governing law and forum with counsel.'
    : '48 U.S.C. § 644a extends Hawaii federal district-court jurisdiction to cases arising here; substantive rights still need review.';
  return {
    name,
    publicity:{summary:`Local review needed; no place-specific publicity claim is verified. ${venue}`, sourceUrl:law},
    privacy:{summary:`Local review needed; no place-specific privacy claim is verified. ${venue}`, sourceUrl:law},
    contract:{summary:`Local review needed; preserve licenses and identify governing law. ${venue}`, sourceUrl:law},
    helpUrl:HELP,
    asOf:'2026-10-25',
  };
}

const names = Object.keys(stateCodes);
const territories = Object.keys(territorySpecific);
export const JURISDICTIONS_B = Object.fromEntries([
  ...names.map((name) => [name, makeState(name)]),
  ...territories.map((name) => [name, makeTerritory(name)]),
  ...outlying.map((name) => [name, makeOutlying(name)]),
]);
