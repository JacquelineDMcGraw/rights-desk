import { JURISDICTIONS_A } from './jurisdictions-a.js';
import { JURISDICTIONS_B } from './jurisdictions-b.js';

export const STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia',
  'Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland',
  'Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
  'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
  'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming',
];
export const TERRITORIES = [
  'Puerto Rico','U.S. Virgin Islands','Guam','Northern Mariana Islands','American Samoa',
  'Baker Island','Howland Island','Jarvis Island','Johnston Atoll','Kingman Reef',
  'Midway Atoll','Navassa Island','Palmyra Atoll','Wake Island',
];
export const WORK_TYPES = [
  ['photograph','Photograph'],['illustration','Illustration or design'],['video','Video or film'],
  ['writing','Writing'],['audio','Music or audio'],['ai_visual','AI-assisted or generated visual'],['other','Other creative work'],
];
export const USE_CHANNELS = [
  ['website','Website or app'],['social','Social platform'],['print','Print publication'],
  ['advertising','Advertisement'],['products','Products or merchandise'],['ai_system','AI system or generated output'],['unknown','Not sure yet'],
];

const workEvidence = {
  photograph: 'Camera originals (RAW or first-generation files), contact sheets, editing history, assignments, and dated publication records.',
  illustration: 'Sketches, source or layered files, drafts, client briefs, and dated publication records.',
  video: 'Original clips, project timelines, edit files, credits, and production agreements.',
  writing: 'Drafts, revision history, notes, bylines, and publication or assignment records.',
  audio: 'Session files, stems, scores, demo recordings, credits, and composition or master-rights agreements.',
  ai_visual: 'Human-created source materials, prompts and iterations, editing files, and a clear record of which expressive parts were human-made.',
  other: 'Original working files, dated drafts, publication records, and any assignment or collaboration agreements.',
};
const useEvidence = {
  website: 'Save the page URL, full-page screenshot, visible date, and the file or page source where possible.',
  social: 'Save post and account URLs, screenshots with timestamps, account name, and engagement or promotion evidence.',
  print: 'Keep a physical copy or dated scan, publication name, issue, page number, and distribution details.',
  advertising: 'Save the ad creative, landing page, campaign dates, advertiser identity, and where it appeared.',
  products: 'Save product listings, purchase receipts if available, packaging photos, seller identity, and dates.',
  ai_system: 'Save the exact output, prompts used to locate it, model or service details, timestamps, and side-by-side examples of specific shared expression.',
  unknown: 'Record where and when you first noticed the possible use, and save any link, screenshot, or physical copy.',
};

export const GUIDE_LINKS = {
  basics: 'https://www.copyright.gov/what-is-copyright/',
  records: 'https://publicrecords.copyright.gov/',
  registration: 'https://www.copyright.gov/registration/',
  dmca: 'https://www.copyright.gov/512/',
  ccb: 'https://www.ccb.gov/claimant/',
  ai: 'https://www.copyright.gov/ai/',
  territories: 'https://www.copyright.gov/circs/circ38a.pdf',
  legalHelp: 'https://www.usa.gov/legal-aid',
};

export const JURISDICTION_GUIDES = { ...JURISDICTIONS_A, ...JURISDICTIONS_B };

export function jurisdictionKind(name) {
  if (name === 'American Samoa') return 'american_samoa';
  if (TERRITORIES.includes(name)) return 'territory';
  if (name === 'District of Columbia') return 'district';
  return 'state';
}

export function guideFor({workType, useChannel, jurisdiction}) {
  const kind = jurisdictionKind(jurisdiction);
  const online = ['website','social'].includes(useChannel);
  const ai = workType === 'ai_visual' || useChannel === 'ai_system';
  let jurisdictionNote;
  if (kind === 'american_samoa') {
    jurisdictionNote = 'American Samoa needs a separate legal review. The U.S. Copyright Office says federal copyright law applies in the U.S. Virgin Islands, Guam, and the Northern Mariana Islands, but not in American Samoa. Do not assume the standard federal claim route applies to a use there.';
  } else if (kind === 'territory' && !['Puerto Rico','U.S. Virgin Islands','Guam','Northern Mariana Islands'].includes(jurisdiction)) {
    jurisdictionNote = `${jurisdiction} has territory-specific legal questions. Preserve the evidence and check the governing law with qualified local counsel before sending a formal claim.`;
  } else {
    jurisdictionNote = `For ${jurisdiction}, start with the applicable U.S. copyright framework. Contract, publicity, privacy, and other local claims depend on the specific place and facts; get local advice before relying on them.`;
  }
  return {
    workEvidence: workEvidence[workType] || workEvidence.other,
    useEvidence: useEvidence[useChannel] || useEvidence.unknown,
    jurisdictionNote,
    localLaw: JURISDICTION_GUIDES[jurisdiction] || null,
    steps: [
      { title:'Preserve the possible use', text:useEvidence[useChannel] || useEvidence.unknown },
      { title:'Show your creation trail', text:workEvidence[workType] || workEvidence.other },
      { title:'Check who controls the rights', text:'Gather assignments, work-for-hire agreements, licenses, releases, registration records, and any permission you may have granted. Owning a file does not always mean owning its copyright.' },
      { title:'Choose the next route', text:kind === 'american_samoa'
        ? 'Ask a qualified local attorney which law and forum apply before using a U.S. takedown or claim process.'
        : useChannel === 'ai_system'
          ? 'Document the exact output or use and compare specific human-created expression. A similar style or suspected training alone is not proof of copying. Review the Copyright Office’s AI materials and consider qualified legal advice.'
        : online
          ? 'If the use is on an online service and you believe you own the relevant rights, review the Copyright Office’s notice-and-takedown guidance. A notice requires good-faith statements and contact details.'
          : 'If the use is in print, ads, or products, preserve the distribution evidence and consider a direct license inquiry or legal advice. The Copyright Claims Board may handle eligible U.S. monetary claims up to $30,000.' },
    ],
    aiNote: ai ? 'AI issues need a careful comparison of protected human expression. A shared style or broad idea alone is not a reliable copying conclusion; fully AI-generated material may have different copyrightability questions.' : '',
  };
}
