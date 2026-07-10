import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { DiscoverabilityForm, type DiscoverabilityData } from "@/components/discoverability-form";

export const metadata = { title: "Discovery — DropQ" };

export default async function DiscoverabilityPage() {
  const seller = await requireSeller();
  const data: DiscoverabilityData = {
    isDiscoverable: seller.isDiscoverable,
    showActiveDropsInDiscovery: seller.showActiveDropsInDiscovery,
    showEventsInDiscovery: seller.showEventsInDiscovery,
    hideExactAddress: seller.hideExactAddress,
    publicNeighborhood: seller.publicNeighborhood,
    publicCity: seller.publicCity ?? seller.location,
    publicState: seller.publicState,
    publicZip: seller.publicZip,
    discoveryRadius: seller.discoveryRadius,
  };

  return (
    <Section>
      <PageHeader
        title="Discovery"
        subtitle="Let nearby customers find your store and drops on DropQ's public Find Drops page."
        action={
          seller.isDiscoverable ? (
            <Link href="/discover" target="_blank" className="text-sm font-medium text-brand hover:underline">
              View discovery page ↗
            </Link>
          ) : undefined
        }
      />
      <DiscoverabilityForm data={data} />
    </Section>
  );
}
