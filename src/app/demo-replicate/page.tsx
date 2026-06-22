export default function DemoReplicatePage() {
  return (
    <main className="min-h-screen bg-[#f0f0f2] p-0 font-sans text-[#333333]">
      <section className="mx-auto w-auto rounded-[0.5em] bg-[#fdfdff] p-[2em] shadow-[2px_3px_7px_2px_rgba(0,0,0,0.02)] min-[700px]:mt-[5em] min-[700px]:w-[600px]">
        <h1 className="mb-4 text-2xl font-bold leading-tight text-[#111111]">
          Example Domain
        </h1>

        <div className="space-y-4 text-base leading-normal">
          <p>
            This domain is for use in illustrative examples in documents. You
            may use this domain in literature without prior coordination or
            asking for permission.
          </p>

          <p>
            <a
              href="https://www.iana.org/domains/example"
              className="text-[#38488f] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38488f]"
            >
              More information...
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
