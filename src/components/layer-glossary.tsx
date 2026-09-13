import type { Layer } from "@/lib/types";

const terms: Partial<Record<Layer, [string, string][]>> = {
  url: [
    ["Hostname", "The website name in the address, such as example.com."],
    ["Path", "The resource named in the URL, such as /about. Query parameters follow a question mark and are removed before any lookup or request. Only the local app requests the page."],
    ["Port", "The numbered entrance for a connection. Websites normally use 443 for HTTPS and 80 for HTTP."],
  ],
  dns: [
    ["DNS", "The Domain Name System looks up records for a name, including the IP addresses a connection can use."],
    ["A and AAAA", "A records return IPv4 addresses; AAAA records return IPv6 addresses."],
    ["CNAME", "An alias pointing one hostname to another name."],
    ["NS and MX", "NS records name the authoritative DNS servers. MX records identify where email is delivered."],
    ["TXT, CAA, HTTPS and SVCB", "TXT holds text such as domain verification. CAA names permitted certificate issuers. HTTPS and SVCB can advertise connection settings."],
    ["TTL", "Time to live: how many seconds a DNS answer may stay in a resolver's cache."],
    ["NOERROR and NXDOMAIN", "NOERROR means the query succeeded, even when that record type has no answers. NXDOMAIN means the queried name was not found."],
  ],
  http: [
    ["HTTP status", "The server's response code: 2xx means success, 3xx often redirects elsewhere, and 4xx or 5xx describes a request or server error."],
    ["Redirect", "A response that tells the client to request another URL. Each response along the way is a hop."],
    ["Response headers", "Metadata sent with the response, including content type, cache instructions and sometimes server or request identifiers."],
    ["GET", "The request method used to retrieve a resource. The local app uses GET without browser cookies or sign-in credentials. The browser edition does not request the inspected website."],
  ],
  tls: [
    ["TLS", "Transport Layer Security encrypts an HTTPS connection. Certificate validation checks the endpoint's identity against the requested hostname and trusted issuers."],
    ["Issuer and chain", "The issuer signs a certificate. Intermediate certificates link that signature back to a root authority trusted by the client."],
    ["Certificate names", "The hostnames or IP addresses covered by a certificate, also called subject alternative names (SANs)."],
    ["Validity and fingerprint", "Validity dates say when a certificate can be used. The SHA-256 fingerprint is an identifier for that exact certificate."],
  ],
  network: [
    ["IP address", "The network address used for a connection. A hostname may return several addresses."],
    ["ASN", "An autonomous system number identifies a network announcing routes to IP addresses. Addresses with the same ASN are grouped here."],
    ["Network prefix", "A block of IP addresses announced together, such as 93.184.216.0/24."],
    ["Registry country", "The country recorded for the address allocation. It is administrative information, not a server location."],
    ["Reverse DNS", "A PTR record that looks up a name from an IP address, the reverse of an ordinary address lookup."],
  ],
  technology: [
    ["Technology signal", "A recognisable name or pattern in response headers or HTML, such as a server header or framework marker."],
    ["Observed and inferred", "Observed information came directly from this run. An inference is an explanation suggested by those observations."],
  ],
  infrastructure: [
    ["Edge and CDN", "A content delivery network handles requests closer to visitors, often caching responses in front of the origin."],
    ["Origin", "The application or server behind a proxy or CDN. Public responses may identify the edge without revealing the origin."],
    ["Inferred", "A platform suggested by the evidence captured in this run, such as a DNS record, a network affiliation or a response signal. Open its evidence to see the clues used."],
  ],
};

export function LayerGlossary({ layer }: { layer: Layer }) {
  const entries = terms[layer];
  if (!entries) return null;
  return <details className="layer-glossary">
    <summary>What do these terms mean?</summary>
    <dl>{entries.map(([term, explanation]) => <div key={term}><dt>{term}</dt><dd>{explanation}</dd></div>)}</dl>
  </details>;
}
