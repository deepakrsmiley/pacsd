// English spelling (Hunspell dictionary through nspell) with radiology vocabulary and a
// personal dictionary kept on this computer.

const PERSONAL_KEY = "pacsd.spelling.personal";

const RADIOLOGY_WORDS = `
hyperdense hypodense isodense hyperattenuating hypoattenuating isoattenuating hyperintense hypointense isointense
hyperechoic hypoechoic isoechoic anechoic echogenic echogenicity echotexture heterogeneous homogeneous heterogeneously
periventricular subependymal subarachnoid subdural extradural epidural intraparenchymal intraventricular infratentorial
supratentorial intracranial extracranial extra-axial intra-axial gyral sulcal sulci gyri cerebellar cerebellopontine
paranasal mastoid mastoids calvarium calvarial sella suprasellar pituitary craniocervical foramen foramina foraminal
basal ganglia thalamic thalami corona radiata centrum semiovale pons pontine medulla midbrain
cholelithiasis choledocholithiasis cholecystitis hepatomegaly splenomegaly hepatosplenomegaly hydronephrosis
hydroureteronephrosis nephrolithiasis urolithiasis ureterolithiasis corticomedullary perinephric pelvicalyceal
pleural pericardial costophrenic cardiophrenic cardiomegaly atelectasis atelectatic pneumothorax hydropneumothorax
pneumoperitoneum lymphadenopathy mediastinal mediastinum hilar perihilar hila bronchiectasis bronchovascular
emphysema emphysematous interstitial reticulonodular reticular nodular centrilobular subpleural peribronchial
osteophyte osteophytes spondylosis spondylolisthesis spondylolysis intervertebral uncovertebral thecal conus cauda equina
paraspinal prevertebral retrolisthesis anterolisthesis desiccation desiccated protrusion extrusion osteopenia
sclerotic lytic periosteal cortical subchondral enthesophyte
axial coronal sagittal multiplanar multisequence multidetector reconstructions reformats reformatted
non-contrast post-contrast contrast-enhanced unenhanced arterial portovenous venous delayed
FLAIR DWI ADC SWI GRE STIR HRCT CECT NCCT CTA MRA MRCP MRI CT USG KUB IVC CBD CXR PA AP HU
mm cm ml cc kV mAs mSv mGy
radiologist radiologists radiological radiograph radiographs radiographic sonography sonographic ultrasonography
fluoroscopy mammography mammographic tomosynthesis angiography angiographic
`.split(/\s+/).filter(Boolean);

let loading = null;

export function personalWords() {
  try {
    return JSON.parse(localStorage.getItem(PERSONAL_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addPersonalWord(spell, word) {
  const words = new Set(personalWords());
  words.add(word);
  try {
    localStorage.setItem(PERSONAL_KEY, JSON.stringify([...words].slice(-2000)));
  } catch {
    // Storage full or disabled; the word still counts for this session.
  }
  spell.add(word);
}

export function loadSpeller() {
  if (!loading) {
    loading = (async () => {
      const [module, aff, dic] = await Promise.all([
        import("nspell"),
        fetch("/dictionaries/en.aff").then((response) => {
          if (!response.ok) throw new Error("The spelling dictionary could not be loaded.");
          return response.text();
        }),
        fetch("/dictionaries/en.dic").then((response) => {
          if (!response.ok) throw new Error("The spelling dictionary could not be loaded.");
          return response.text();
        }),
      ]);
      const nspell = module.default || module;
      const spell = nspell(aff, dic);
      for (const word of RADIOLOGY_WORDS) spell.add(word);
      for (const word of personalWords()) spell.add(word);
      return spell;
    })().catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

const WORD = /[\p{L}][\p{L}'’-]*[\p{L}]|[\p{L}]/gu;

// Misspelled words in document order, skipping fields, numbers, acronyms and deleted text.
export function misspellings(doc, spell, ignored = new Set()) {
  const found = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((mark) => mark.type.name === "deletion" || mark.type.name === "link")) return false;
    const value = node.text;
    WORD.lastIndex = 0;
    for (let match = WORD.exec(value); match; match = WORD.exec(value)) {
      const word = match[0].replace(/['’]+$/, "");
      if (word.length < 2) continue;
      if (/^[\p{Lu}\d]+$/u.test(word) && word.length <= 6) continue;
      const before = value[match.index - 1];
      const after = value[match.index + match[0].length];
      if (/\d/.test(before || "") || /\d/.test(after || "")) continue;
      if (ignored.has(word.toLowerCase())) continue;
      if (spell.correct(word) || spell.correct(word.toLowerCase())) continue;
      if (word.includes("-") && word.split("-").every((part) => !part || spell.correct(part) || spell.correct(part.toLowerCase()))) continue;
      found.push({ word, from: pos + match.index, to: pos + match.index + word.length });
    }
    return false;
  });
  return found;
}
