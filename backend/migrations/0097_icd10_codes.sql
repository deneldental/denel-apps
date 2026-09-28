-- admin-v1 CC.1 — WHO ICD-10 reference table + curated dental favourites seed.
-- Public domain. Full set can be loaded behind search later; this seeds the
-- chapter K00–K14 dental set + a few selected S/Z codes. Idempotent:
-- CREATE IF NOT EXISTS + ON CONFLICT (unique code) DO NOTHING.

CREATE TABLE IF NOT EXISTS "icd10_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "parentCode" text,
  "billable" boolean DEFAULT true NOT NULL,
  "version" text DEFAULT 'ICD-10' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icd10_codes_code_unique" ON "icd10_codes" ("code");
--> statement-breakpoint
INSERT INTO "icd10_codes" ("code", "title", "parentCode", "billable") VALUES
  ('K00', 'Disorders of tooth development and eruption', NULL, false),
  ('K00.1', 'Supernumerary teeth', 'K00', true),
  ('K00.6', 'Disturbances in tooth eruption', 'K00', true),
  ('K01', 'Embedded and impacted teeth', NULL, false),
  ('K01.1', 'Impacted teeth', 'K01', true),
  ('K02', 'Dental caries', NULL, false),
  ('K02.1', 'Caries of dentine', 'K02', true),
  ('K02.3', 'Arrested dental caries', 'K02', true),
  ('K02.9', 'Dental caries, unspecified', 'K02', true),
  ('K03', 'Other diseases of hard tissues of teeth', NULL, false),
  ('K03.0', 'Excessive attrition of teeth', 'K03', true),
  ('K03.1', 'Abrasion of teeth', 'K03', true),
  ('K03.2', 'Erosion of teeth', 'K03', true),
  ('K03.6', 'Deposits [accretions] on teeth', 'K03', true),
  ('K04', 'Diseases of pulp and periapical tissues', NULL, false),
  ('K04.0', 'Pulpitis', 'K04', true),
  ('K04.1', 'Necrosis of pulp', 'K04', true),
  ('K04.5', 'Chronic apical periodontitis', 'K04', true),
  ('K04.6', 'Periapical abscess with sinus', 'K04', true),
  ('K04.7', 'Periapical abscess without sinus', 'K04', true),
  ('K05', 'Gingivitis and periodontal diseases', NULL, false),
  ('K05.0', 'Acute gingivitis', 'K05', true),
  ('K05.1', 'Chronic gingivitis', 'K05', true),
  ('K05.2', 'Acute periodontitis', 'K05', true),
  ('K05.3', 'Chronic periodontitis', 'K05', true),
  ('K06', 'Other disorders of gingiva and edentulous alveolar ridge', NULL, false),
  ('K06.0', 'Gingival recession', 'K06', true),
  ('K06.1', 'Gingival enlargement', 'K06', true),
  ('K07', 'Dentofacial anomalies [including malocclusion]', NULL, false),
  ('K07.3', 'Anomalies of tooth position', 'K07', true),
  ('K07.4', 'Malocclusion, unspecified', 'K07', true),
  ('K07.6', 'Temporomandibular joint disorders', 'K07', true),
  ('K08', 'Other disorders of teeth and supporting structures', NULL, false),
  ('K08.1', 'Loss of teeth due to extraction or periodontal disease', 'K08', true),
  ('K08.3', 'Retained dental root', 'K08', true),
  ('K12', 'Stomatitis and related lesions', NULL, false),
  ('K12.0', 'Recurrent oral aphthae', 'K12', true),
  ('K13', 'Other diseases of lip and oral mucosa', NULL, false),
  ('K13.7', 'Other and unspecified lesions of oral mucosa', 'K13', true),
  ('S02.5', 'Fracture of tooth (traumatic)', NULL, true),
  ('Z01.2', 'Dental examination', NULL, true),
  ('Z46.3', 'Fitting and adjustment of dental prosthetic device', NULL, true)
ON CONFLICT ("code") DO NOTHING;
