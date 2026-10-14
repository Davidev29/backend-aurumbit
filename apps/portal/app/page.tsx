import { Suspense } from "react";
import { PortalProvider } from "@/lib/portal-context";
import { Navbar, Footer, StickyCta, BackToTop } from "@/components/layout";
import { Hero, SummarySection, ProductsSection, PurposeSection, ServicesSection, AiAgentsSection, CostBenefitSection, AssuranceSection, HowItWorksSection, FaqSection, FinalCTASection } from "@/components/sections";
import { AuthModalWrapper } from "@/components/auth/AuthModalWrapper";
import { LoginParamOpener } from "@/components/auth/LoginParamOpener";
import { mockCatalogPage } from "@/lib/mocks";

export const revalidate = 60;

const FAQS = [
  {
    question: "Funciona sem internet mesmo?",
    answer:
      "Sim. Os programas funcionam offline por natureza — a internet só é usada para validar a licença e trazer novidades. Se a conexão cair no meio do expediente, o trabalho continua.",
  },
  {
    question: "Como instalo? Preciso de técnico?",
    answer:
      "Não. Você recebe a chave após a confirmação do pagamento e segue um passo a passo simples no próprio computador. Se travar, nosso atendimento ajuda em português.",
  },
  {
    question: "Em quantos computadores posso usar?",
    answer:
      "Depende do plano: 1 computador no Base, 3 no Pro e 50 ou mais no Enterprise. As regras para trocar de computador estão escritas no seu plano — e se precisar, nosso atendimento ajuda em português.",
  },
  {
    question: "Quais são as formas de pagamento?",
    answer:
      "Pix, boleto ou cartão, em ambiente de pagamento seguro. O total e as condições aparecem escritos antes de você confirmar, e a chave é liberada após a confirmação do pagamento.",
  },
  {
    question: "Posso cancelar quando quiser?",
    answer:
      "As condições e os prazos de cancelamento ficam escritos antes de você confirmar o pagamento. Se precisar cancelar, fale com nosso atendimento em português: contato@aurumbit.com.",
  },
  {
    question: "Meus dados e os dos meus clientes estão protegidos?",
    answer:
      "Sim, com cuidado de verdade: acesso só para quem você autorizar, registros de uso e práticas alinhadas à lei de proteção de dados (LGPD). Não prometemos “segurança absoluta” — nenhuma empresa séria promete isso — mas tratamos seus dados com responsabilidade e explicamos como, se você pedir.",
  },
  {
    question: "Roda no meu computador?",
    answer:
      "Sim, se for Windows ou macOS. Cada plano libera um número de computadores: 1 no Base, 3 no Pro e 50 ou mais no Enterprise.",
  },
  {
    question: "Se eu trocar de computador, perco a chave?",
    answer:
      "Não. As regras para trocar de computador estão escritas no seu plano — e se precisar, nosso atendimento ajuda em português.",
  },
];

export default async function LandingPage() {
  // Server Component: primeira pintura + SEO com dados do backend.
  // Sem `API_INTERNAL_URL` usa o catálogo stub (mesma fonte do BFF).
  const products = mockCatalogPage("", null).data;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://aurumbit.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organizacao`,
        name: "AurumBit",
        url: siteUrl,
        email: "contato@aurumbit.com",
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#site`,
        url: siteUrl,
        name: "AurumBit",
        inLanguage: "pt-BR",
        publisher: { "@id": `${siteUrl}/#organizacao` },
      },
      ...products.map((p) => {
        const minCents = Math.min(...p.plans.map((plan) => plan.priceCents));
        return {
          "@type": "SoftwareApplication",
          name: p.name,
          url: `${siteUrl}/#produtos`,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Windows, macOS",
          inLanguage: "pt-BR",
          offers: {
            "@type": "Offer",
            priceCurrency: "BRL",
            price: (minCents / 100).toFixed(2),
            availability: "https://schema.org/InStock",
          },
        };
      }),
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
      {
        "@type": "HowTo",
        name: "Como começar a usar a AurumBit",
        inLanguage: "pt-BR",
        step: [
          { "@type": "HowToStep", name: "Você escolhe o plano e paga", text: "Pix, boleto ou cartão, com o total e as condições escritos antes de confirmar." },
          { "@type": "HowToStep", name: "Você recebe a chave", text: "Liberada logo após a confirmação do pagamento, junto com o passo a passo de instalação." },
          { "@type": "HowToStep", name: "Você instala e usa", text: "Nos computadores liberados pelo plano, com ou sem internet." },
        ],
      },
    ],
  };

  return (
    <PortalProvider>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-bg0">
        <Navbar />
        <main id="main-content" tabIndex={-1} className="pt-0 focus:outline-none">
          <Hero />
          <SummarySection />
          <ProductsSection products={products} />
          <PurposeSection />
          <HowItWorksSection />
          <ServicesSection />
          <AiAgentsSection />
          <CostBenefitSection />
          <AssuranceSection />
          <FaqSection />
          <FinalCTASection />
        </main>
        <Footer />
        <StickyCta />
        <BackToTop />
        <AuthModalWrapper />
        <Suspense fallback={null}>
          <LoginParamOpener />
        </Suspense>
      </div>
    </PortalProvider>
  );
}
