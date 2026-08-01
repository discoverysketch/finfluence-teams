// The Oracle contract corpus for a Fusion ERP/SCM/HCM deal in the US.
//
// Deliberately small and hand-picked. Oracle publishes ~750 documents at
// oracle.com/contracts and most are irrelevant to this motion (Aconex, NetSuite,
// Taleo, hospitality, 130 country variants of the CSA). What governs a US
// Fusion cloud deal is this handful.
//
// EVERY entry is the CURRENT version. Oracle keeps every superseded version
// online next to the live one, so picking by title alone will silently give you
// a decade-old policy. version carries what the file itself says; when Oracle
// republishes, `npm run load-contracts` re-fetches and the version shown in the
// UI changes with it.
export type ContractDoc = {
  key: string;
  title: string;
  category: "Agreement" | "Pillar" | "Policy" | "Service description" | "Security" | "AI";
  url: string;
  version: string;
  effective: string;
  /** What a rep actually uses this document for. Shown in the UI. */
  covers: string;
};

export const CONTRACT_DOCS: ContractDoc[] = [
  {
    key: "csa", title: "Oracle Cloud Services Agreement (US)", category: "Agreement",
    url: "https://www.oracle.com/contracts/docs/cloud_csa_online_v062223_us_eng.pdf",
    version: "v062223", effective: "22 Jun 2023",
    covers: "The master terms: term and termination, fees, warranties, indemnity, liability caps, suspension, governing law.",
  },
  {
    key: "pillar_saas", title: "SaaS Public Cloud Services Pillar Document", category: "Pillar",
    url: "https://www.oracle.com/contracts/docs/saas_public_cloud_services_pillar_3610529.pdf",
    version: "3610529", effective: "current",
    covers: "SaaS-specific rules layered on the CSA: service periods, hosted named user metrics, data return and deletion, upgrades.",
  },
  {
    key: "fusion_service_desc", title: "Fusion Cloud Services — Service Descriptions", category: "Service description",
    url: "https://www.oracle.com/contracts/docs/oracle-fusion-cloud-service-desc-1843611.pdf",
    version: "1843611", effective: "current",
    covers: "What each Fusion ERP/SCM/HCM SKU actually includes, and the metric it is licensed by.",
  },
  {
    key: "hosting_delivery", title: "Oracle Cloud Hosting and Delivery Policies", category: "Policy",
    url: "https://www.oracle.com/contracts/docs/ocloud_hosting_delivery_policies_3089853.pdf",
    version: "3089853", effective: "current",
    covers: "Uptime commitment and service credits, disaster recovery, backup, maintenance windows, security incident handling.",
  },
  {
    key: "dpa", title: "Data Processing Agreement for Oracle Services", category: "Policy",
    url: "https://www.oracle.com/contracts/docs/data-processing-agreement-oracle-services-081425.pdf",
    version: "081425", effective: "14 Aug 2025",
    covers: "Processor obligations, sub-processors, international transfers, breach notification, audit rights.",
  },
  {
    key: "ai_terms", title: "Oracle Artificial Intelligence Terms", category: "AI",
    url: "https://www.oracle.com/contracts/docs/oracle-ai-terms.pdf",
    version: "current", effective: "current",
    covers: "How AI features may be used, what Oracle may do with inputs and outputs, and whether customer data trains models.",
  },
  {
    key: "security_practices", title: "Oracle Corporate Security Practices", category: "Security",
    url: "https://www.oracle.com/contracts/docs/corporate-security-practices-4490843.pdf",
    version: "4490843", effective: "current",
    covers: "Oracle's own security programme — the answer to most vendor security questionnaires.",
  },
  {
    key: "fusion_prof_services", title: "Oracle Fusion Cloud Professional Services", category: "Service description",
    url: "https://www.oracle.com/contracts/docs/corporate_oracle_fusion_cloud_professional_services.pdf",
    version: "current", effective: "current",
    covers: "Terms for the implementation services attached to a Fusion deal.",
  },
];

export const docByKey = (k: string) => CONTRACT_DOCS.find((d) => d.key === k);
