import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import { getPhotoCredits } from "@/lib/menu-source";

export const metadata: Metadata = {
  title: "Photo credits",
  description:
    "Credits and licences for the dish photographs used on the Next Level Family Restaurant menu.",
};

const LICENSE_URLS: Record<string, string> = {
  "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
};

/* "CC BY-SA 4.0" -> https://creativecommons.org/licenses/by-sa/4.0/ */
function licenseUrl(license: string): string | null {
  if (LICENSE_URLS[license]) return LICENSE_URLS[license];
  const m = license.match(/^CC (BY(?:-SA)?) (\d\.\d)$/);
  return m
    ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/`
    : null;
}

export default async function CreditsPage() {
  const credits = await getPhotoCredits();
  return (
    <>
      <PageIntro kicker="Thank you" title="Photo credits">
        Some dish photos on our menu are by other photographers and used under
        Creative Commons licences. We thank them below.
      </PageIntro>

      <section className="section--flush-top">
        <div className="container">
          {credits.length === 0 ? (
            <p className="credits-note">
              No third-party photo credits are currently required.
            </p>
          ) : (
          <div className="credits-scroll">
            <table className="credits-table">
              <thead>
                <tr>
                  <th>Dish</th>
                  <th>Photo by</th>
                  <th>Licence</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {credits.map(({ dish, credit: c }) => {
                  const url = licenseUrl(c.license);
                  return (
                    <tr key={c.sourceUrl}>
                      <td>{dish}</td>
                      <td>{c.author}</td>
                      <td>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer license">
                            {c.license}
                          </a>
                        ) : (
                          c.license
                        )}
                      </td>
                      <td>
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                          View original
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
          <p className="credits-note">
            Photos may have been cropped and resized. Where a dish comes in full
            and half portions, both share the same photo.
          </p>
        </div>
      </section>
    </>
  );
}
