import { useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Mail, MapPin } from "lucide-react";
import { z } from "zod";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/db";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { TRADE_DOCUMENT_ACCEPT, tradeDocumentProblem } from "@/lib/tradeDocumentRules";

const showroomOptions = [
  "No preference",
  "Orem",
  "Sandy",
  "Heber City",
  "Midvale",
  "Layton",
  "St. George",
] as const;

/** Trade-only selects. Kept short — long lists read as paperwork. */
const tradeRoleOptions = [
  "Builder",
  "Interior designer",
  "Architect",
  "Electrician",
  "Remodeler",
  "Other trade",
] as const;

const projectScaleOptions = [
  "Single home",
  "2 – 10 homes a year",
  "10+ homes a year",
  "Multifamily / commercial",
] as const;

const contactSchema = z.object({
  name: z.string().trim().min(1, { message: "Please enter your name" }).max(100, {
    message: "Name must be less than 100 characters",
  }),
  email: z
    .string()
    .trim()
    .min(1, { message: "Please enter your email" })
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
  phone: z
    .string()
    .trim()
    .max(30, { message: "Phone must be less than 30 characters" })
    .optional(),
  showroom: z.enum(showroomOptions),
  message: z
    .string()
    .trim()
    .min(1, { message: "Please tell us a little about your project" })
    .max(1000, { message: "Message must be less than 1000 characters" }),
  company: z
    .string()
    .trim()
    .max(120, { message: "Company must be less than 120 characters" })
    .optional(),
  address: z
    .string()
    .trim()
    .max(200, { message: "Address must be less than 200 characters" })
    .optional(),
  taxId: z
    .string()
    .trim()
    .max(40, { message: "Tax ID must be less than 40 characters" })
    .optional(),
  tradeRole: z.string().trim().max(60).optional(),
  projectScale: z.string().trim().max(60).optional(),
});

/** In trade mode every contact detail is required, plus company, address, and tax ID. */
const tradeSchema = contactSchema.extend({
  phone: z
    .string()
    .trim()
    .min(7, { message: "Please enter your phone number" })
    .max(30, { message: "Phone must be less than 30 characters" }),
  company: z
    .string()
    .trim()
    .min(1, { message: "Please enter your company name" })
    .max(120, { message: "Company must be less than 120 characters" }),
  address: z
    .string()
    .trim()
    .min(1, { message: "Please enter your business address" })
    .max(200, { message: "Address must be less than 200 characters" }),
  taxId: z
    .string()
    .trim()
    .min(1, { message: "Please enter your Tax ID number" })
    .max(40, { message: "Tax ID must be less than 40 characters" }),
});

type ContactValues = z.infer<typeof contactSchema>;
type FieldErrors = Partial<Record<keyof ContactValues, string>> & {
  salesTaxCert?: string;
};


const emptyForm: ContactValues = {
  name: "",
  email: "",
  phone: "",
  showroom: "No preference",
  message: "",
  company: "",
  address: "",
  taxId: "",
  tradeRole: tradeRoleOptions[0],
  projectScale: projectScaleOptions[1],
};

const ContactPage = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  /** `/contact-us-trade-account` (or legacy `/contact?type=trade`) opens the form in trade mode. */
  const isTrade = useMemo(
    () =>
      pathname.toLowerCase().startsWith("/contact-us-trade-account") ||
      (searchParams.get("type") ?? "").toLowerCase() === "trade",
    [searchParams, pathname],
  );
  const [values, setValues] = useState<ContactValues>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [taxExempt, setTaxExempt] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);

  const update = (field: keyof ContactValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const pickCert = (file: File | null) => {
    setCertFile(file);
    setErrors((prev) => ({ ...prev, salesTaxCert: undefined }));
  };


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = (isTrade ? tradeSchema : contactSchema).safeParse(values);

    const nextErrors: FieldErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ContactValues;
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
    }
    if (isTrade && taxExempt) {
      if (!certFile) {
        nextErrors.salesTaxCert = "Please upload your sales tax certificate";
      } else {
        const problem = tradeDocumentProblem(certFile);
        if (problem) nextErrors.salesTaxCert = problem;
      }
    }
    if (!result.success || Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      const { company, tradeRole, projectScale, address, taxId, ...base } = result.data;

      // Tax-exempt certificates land in a private bucket; the email carries the path.
      let salesTaxCertPath: string | null = null;
      if (isTrade && taxExempt && certFile) {
        const ext = certFile.name.split(".").pop()?.toLowerCase() ?? "pdf";
        const { data: signed, error: signError } = await supabase.functions.invoke("contact-inquiry", {
          body: { action: "cert-upload-url", ext, company: company ?? "trade" },
        });
        if (signError || !signed?.path || !signed?.token) throw signError ?? new Error("Upload unavailable");
        salesTaxCertPath = signed.path as string;
        const { error: uploadError } = await supabase.storage
          .from("trade-documents")
          .uploadToSignedUrl(signed.path, signed.token, certFile, {
            contentType: certFile.type || "application/octet-stream",
          });
        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.functions.invoke("contact-inquiry", {
        body: isTrade
          ? {
              ...base,
              inquiryType: "trade",
              company,
              tradeRole,
              projectScale,
              address,
              taxId,
              taxExempt,
              salesTaxCertPath,
            }
          : { ...base, inquiryType: "general" },
      });
      if (error) throw error;


      toast({
        title: "Thank you — we'll be in touch.",
        description:
          "Your message went to the showroom you selected. A lighting consultant will follow up within one business day.",
      });
      setValues(emptyForm);
      setTaxExempt(false);
      setCertFile(null);
    } catch (err) {
      const details =
        err instanceof FunctionsHttpError ? await err.context.text() : String(err);
      console.error("contact-inquiry failed:", details);
      toast({
        title: "We couldn't send your message.",
        description: "Please try again, or call us at (801) 566-1495.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8 pt-4 pb-2">
        <Breadcrumbs />
      </div>

      <section className="mx-auto max-w-[1400px] px-4 sm:px-8 pt-4 pb-10 md:pb-14">
        <div className="max-w-2xl">
          {isTrade && (
            <p className="text-[10px] font-sans tracking-[0.35em] uppercase text-nova-stone mb-4">
              Builders, Designers &amp; Trade
            </p>
          )}
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-light text-foreground tracking-[-0.01em] leading-tight">
            {isTrade ? "Open a Trade Account" : "Contact Us"}
          </h1>
          <p className="mt-4 text-muted-foreground text-sm sm:text-base leading-relaxed">
            {isTrade
              ? "Tell us about your company and the work ahead. A trade consultant will follow up with pricing, spec support, and a dedicated point of contact."
              : "Tell us about your space and a lighting consultant will help you think through scale, placement, and finish. We answer every message."}
          </p>
          {isTrade && (
            <p className="mt-3 text-xs text-muted-foreground">
              Not with the trade?{" "}
              <Link to="/contact" className="underline hover:text-foreground transition-colors">
                Use our general contact form
              </Link>
              .
            </p>
          )}
        </div>
      </section>


      <section className="mx-auto max-w-[1400px] px-4 sm:px-8 pb-20 md:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="lg:col-span-7 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="contact-name">Name</Label>
                <Input
                  id="contact-name"
                  name="name"
                  autoComplete="name"
                  value={values.name}
                  onChange={(e) => update("name", e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "contact-name-error" : undefined}
                />
                {errors.name && (
                  <p id="contact-name-error" className="text-xs text-destructive">
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-email">Email</Label>
                <Input
                  id="contact-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(e) => update("email", e.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "contact-email-error" : undefined}
                />
                {errors.email && (
                  <p id="contact-email-error" className="text-xs text-destructive">
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-phone">
                Phone{" "}
                {!isTrade && <span className="text-muted-foreground">(optional)</span>}
              </Label>
              <Input
                id="contact-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={values.phone ?? ""}
                onChange={(e) => update("phone", e.target.value)}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? "contact-phone-error" : undefined}
              />
              {errors.phone && (
                <p id="contact-phone-error" className="text-xs text-destructive">
                  {errors.phone}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-showroom">Preferred showroom</Label>
              <Select
                value={values.showroom}
                onValueChange={(value) => update("showroom", value)}
              >
                <SelectTrigger id="contact-showroom" className="w-full">
                  <SelectValue placeholder="Select a showroom" />
                </SelectTrigger>
                <SelectContent>
                  {showroomOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Trade-only fields — shown when arriving via /contact?type=trade */}
            {isTrade && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="contact-company">Company</Label>
                  <Input
                    id="contact-company"
                    name="company"
                    autoComplete="organization"
                    value={values.company ?? ""}
                    onChange={(e) => update("company", e.target.value)}
                    aria-invalid={Boolean(errors.company)}
                    aria-describedby={errors.company ? "contact-company-error" : undefined}
                  />
                  {errors.company && (
                    <p id="contact-company-error" className="text-xs text-destructive">
                      {errors.company}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-address">Business address</Label>
                  <Input
                    id="contact-address"
                    name="address"
                    autoComplete="street-address"
                    placeholder="Street, city, state, ZIP"
                    value={values.address ?? ""}
                    onChange={(e) => update("address", e.target.value)}
                    aria-invalid={Boolean(errors.address)}
                    aria-describedby={errors.address ? "contact-address-error" : undefined}
                  />
                  {errors.address && (
                    <p id="contact-address-error" className="text-xs text-destructive">
                      {errors.address}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-tax-id">Tax ID number</Label>
                  <Input
                    id="contact-tax-id"
                    name="taxId"
                    inputMode="text"
                    value={values.taxId ?? ""}
                    onChange={(e) => update("taxId", e.target.value)}
                    aria-invalid={Boolean(errors.taxId)}
                    aria-describedby={errors.taxId ? "contact-tax-id-error" : undefined}
                  />
                  {errors.taxId && (
                    <p id="contact-tax-id-error" className="text-xs text-destructive">
                      {errors.taxId}
                    </p>
                  )}
                </div>

                <div className="space-y-3 border border-border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="contact-tax-exempt"
                      checked={taxExempt}
                      onCheckedChange={(checked) => {
                        setTaxExempt(checked === true);
                        if (checked !== true) pickCert(null);
                      }}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="contact-tax-exempt"
                      className="text-sm font-normal leading-relaxed"
                    >
                      Are you tax-exempt?
                    </Label>
                  </div>

                  {taxExempt && (
                    <div className="space-y-2 pl-7">
                      <Label htmlFor="contact-sales-tax-cert">
                        Sales tax certificate
                      </Label>
                      <Input
                        id="contact-sales-tax-cert"
                        name="salesTaxCert"
                        type="file"
                        accept={TRADE_DOCUMENT_ACCEPT}
                        onChange={(e) => pickCert(e.target.files?.[0] ?? null)}
                        aria-invalid={Boolean(errors.salesTaxCert)}
                        aria-describedby={
                          errors.salesTaxCert ? "contact-sales-tax-cert-error" : undefined
                        }
                        className="cursor-pointer file:mr-3 file:text-xs file:text-muted-foreground"
                      />
                      <p className="text-xs text-muted-foreground">
                        PDF, JPG or PNG, up to 10 MB.
                      </p>
                      {errors.salesTaxCert && (
                        <p
                          id="contact-sales-tax-cert-error"
                          className="text-xs text-destructive"
                        >
                          {errors.salesTaxCert}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="contact-trade-role">Your role</Label>
                    <Select
                      value={values.tradeRole}
                      onValueChange={(value) => update("tradeRole", value)}
                    >
                      <SelectTrigger id="contact-trade-role" className="w-full">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        {tradeRoleOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contact-project-scale">Project volume</Label>
                    <Select
                      value={values.projectScale}
                      onValueChange={(value) => update("projectScale", value)}
                    >
                      <SelectTrigger id="contact-project-scale" className="w-full">
                        <SelectValue placeholder="Select a volume" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectScaleOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}


            <div className="space-y-2">
              <Label htmlFor="contact-message">
                {isTrade ? "Tell us about the work ahead" : "How can we help?"}
              </Label>
              <Textarea
                id="contact-message"
                name="message"
                rows={6}
                maxLength={1000}
                placeholder={
                  isTrade
                    ? "Timelines, plan sets, finishes you spec often, anything we should know."
                    : undefined
                }
                value={values.message}
                onChange={(e) => update("message", e.target.value)}
                aria-invalid={Boolean(errors.message)}
                aria-describedby={errors.message ? "contact-message-error" : undefined}
              />
              {errors.message && (
                <p id="contact-message-error" className="text-xs text-destructive">
                  {errors.message}
                </p>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="min-w-[180px]">
              {isTrade ? "Request an account" : "Send message"}
            </Button>

          </form>

          {/* Details */}
          <aside className="lg:col-span-5 space-y-8">
            <div className="space-y-4 border-t border-border pt-6">
              <h2 className="font-serif text-xl font-light text-foreground tracking-[-0.01em]">
                Reach us directly
              </h2>

              <Link
                to="/locations"
                className="flex items-start gap-3 text-sm text-foreground/70 hover:text-foreground transition-colors"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>
                  Prefer to call? Every showroom's direct number is on our
                  locations page — six in Utah, Layton to St. George.
                </span>
              </Link>

              <a
                href="mailto:info@novalighting.com"
                className="flex items-center gap-3 text-sm text-foreground/70 hover:text-foreground transition-colors"
              >
                <Mail className="h-4 w-4 shrink-0 text-accent" />
                <span>info@novalighting.com</span>
              </a>
            </div>


            <div className="space-y-2 border-t border-border pt-6">
              <h2 className="font-serif text-xl font-light text-foreground tracking-[-0.01em]">
                Showroom hours
              </h2>
              <p className="text-sm text-muted-foreground">Monday – Friday: 9 AM – 5 PM</p>
              <p className="text-sm text-muted-foreground">
                Saturday: Midvale only, 10 AM – 5 PM
              </p>
              <p className="text-sm text-muted-foreground">Sunday: Closed</p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
};

export default ContactPage;
