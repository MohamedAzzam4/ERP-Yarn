import { ProductionReceipt } from "./SingleYarnReceipt";

// Re-export so the twisted-yarn receipt shares the same template.
export default function TwistedYarnReceipt() {
  return <ProductionReceipt lotType="twisted" />;
}
