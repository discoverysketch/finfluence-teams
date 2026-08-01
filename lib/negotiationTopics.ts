// The requests that actually come back from a customer's legal and procurement
// team on a Fusion cloud deal.
//
// These are questions, not answers. Every one is resolved by retrieving the
// governing clauses and reading them — nothing here asserts what Oracle will
// concede, because that is a Deal Desk decision and inventing it would be worse
// than useless.
//
// `question` is what gets searched and answered, so it is phrased with the
// words the documents actually use. `ask` is the customer's framing, which is
// what the rep will hear in the room.
export type Topic = {
  key: string;
  group: "Commercials" | "Liability & risk" | "Data & privacy" | "AI" | "Service levels" | "Exit";
  ask: string;
  question: string;
};

export const TOPICS: Topic[] = [
  // ---- Commercials ----
  { key: "price_uplift", group: "Commercials", ask: "Cap the uplift at renewal",
    question: "Do the standard terms limit how much the fees can increase on renewal, and how are renewal fees and the services period set?" },
  { key: "overage", group: "Commercials", ask: "What happens if we exceed our user count",
    question: "What happens if the customer exceeds the quantity of services ordered, and how are excess users charged?" },
  { key: "payment_terms", group: "Commercials", ask: "Extend payment terms past 30 days",
    question: "What are the standard payment terms, invoicing and late payment provisions?" },
  { key: "termination_convenience", group: "Commercials", ask: "Terminate for convenience",
    question: "Can the customer terminate the agreement or an order for convenience, and are fees refundable on termination?" },

  // ---- Liability & risk ----
  { key: "liability_cap", group: "Liability & risk", ask: "Raise the liability cap",
    question: "What is the aggregate limitation of liability, what damages are excluded, and what carve-outs from the cap exist?" },
  { key: "ip_indemnity", group: "Liability & risk", ask: "Broaden the IP indemnity",
    question: "What is the intellectual property infringement indemnity, what is excluded from it, and what remedies does Oracle have?" },
  { key: "warranty", group: "Liability & risk", ask: "Strengthen the service warranty",
    question: "What warranty is given for the services, what is disclaimed, and what is the exclusive remedy for breach of warranty?" },
  { key: "insurance_audit", group: "Liability & risk", ask: "Audit rights over Oracle",
    question: "What audit and inspection rights does the customer have over Oracle, including third party audit reports and certifications?" },

  // ---- Data & privacy ----
  { key: "data_location", group: "Data & privacy", ask: "Keep our data in-region",
    question: "Where is customer content hosted and stored, and what governs international transfers of personal data?" },
  { key: "subprocessors", group: "Data & privacy", ask: "Approve sub-processors",
    question: "How are sub-processors appointed, notified and objected to under the data processing agreement?" },
  { key: "breach_notice", group: "Data & privacy", ask: "Tighten breach notification",
    question: "What are Oracle's obligations to notify the customer of a security incident or personal data breach, and in what timeframe?" },
  { key: "confidentiality", group: "Data & privacy", ask: "Confidentiality and data ownership",
    question: "Who owns customer content, what confidentiality obligations apply, and how is confidential information protected?" },

  // ---- AI ----
  { key: "ai_training", group: "AI", ask: "Never train models on our data",
    question: "Does Oracle use customer content or inputs to train or improve artificial intelligence models, and what are the restrictions on AI functionality?" },
  { key: "ai_output", group: "AI", ask: "Who owns and is responsible for AI output",
    question: "Who owns AI output, what responsibility does the customer have for its use, and what does Oracle disclaim about accuracy of output?" },

  // ---- Service levels ----
  { key: "uptime", group: "Service levels", ask: "Better uptime and service credits",
    question: "What is the target service availability percentage, how is unplanned downtime defined and excluded, and what service credits apply?" },
  { key: "support_response", group: "Service levels", ask: "Faster support response times",
    question: "What severity levels and support response commitments apply under the cloud support policy?" },
  { key: "maintenance", group: "Service levels", ask: "Limit maintenance windows and forced upgrades",
    question: "What are the maintenance windows, and how are updates, upgrades and version changes applied to the cloud service?" },
  { key: "disaster_recovery", group: "Service levels", ask: "Disaster recovery and backup commitments",
    question: "What backup, disaster recovery, recovery point and recovery time commitments apply to the cloud service?" },

  // ---- Exit ----
  { key: "data_return", group: "Exit", ask: "Get our data back on exit",
    question: "On termination or expiry, how does the customer retrieve its content, for how long is it available, and when is it deleted?" },
  { key: "suspension", group: "Service levels", ask: "Limit Oracle's right to suspend",
    question: "In what circumstances may Oracle suspend the customer's access to the services, and what notice is given?" },
];

export const GROUPS = ["Commercials", "Liability & risk", "Data & privacy", "AI", "Service levels", "Exit"] as const;
export const topicByKey = (k: string) => TOPICS.find((t) => t.key === k);
