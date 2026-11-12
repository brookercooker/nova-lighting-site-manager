import { useState, FormEvent } from "react";
import { supabase } from "@/lib/db";
import { toast } from "@/hooks/use-toast";

/**
 * Newsletter Signup — reusable Mailchimp signup section.
 * Extracted from the original TestForm so it can be dropped into pages as an Object.
 */
export default function MailchimpForm({ tags = ["Newsletter"] }: { tags?: string[] } = {}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("mailchimp-subscribe", {
        body: {
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          tags,
        },
      });
      if (error || (data && (data as { error?: string }).error)) {
        const msg = (data as { error?: string })?.error || error?.message || "Something went wrong.";
        toast({ title: "Submission failed", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: "Thanks! Check your email to confirm your subscription." });
      setFirstName(""); setLastName(""); setPhone(""); setAddress(""); setEmail("");
    } catch (err) {
      toast({
        title: "Submission failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-transparent border border-ink/20 px-4 py-3 text-sm font-sans text-ink placeholder:text-stone focus:outline-none focus:border-ink transition-colors";
  const labelCls = "block text-[11px] font-sans tracking-[0.22em] uppercase text-ink mb-2";

  return (
    <section className="bg-cream">
      <div className="mx-auto max-w-2xl px-6 sm:px-10 py-16 sm:py-24">
        <p className="text-[10px] font-sans tracking-[0.35em] uppercase text-garnet font-semibold mb-4">
          Newsletter
        </p>
        <h2 className="font-serif text-3xl sm:text-4xl text-ink font-light leading-tight mb-4">
          Stay in touch
        </h2>
        <p className="text-stone text-sm leading-relaxed mb-10">
          Occasional notes on new arrivals, showroom events, and design ideas.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className={labelCls} htmlFor="mc-firstName">First Name</label>
              <input id="mc-firstName" type="text" required maxLength={100}
                value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="mc-lastName">Last Name</label>
              <input id="mc-lastName" type="text" required maxLength={100}
                value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="mc-phone">Cell Phone Number</label>
            <input id="mc-phone" type="tel" required maxLength={40}
              value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="mc-address">Address</label>
            <input id="mc-address" type="text" required maxLength={200}
              value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, City, State, Zip" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="mc-email">Email Address</label>
            <input id="mc-email" type="email" required maxLength={254}
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com" className={inputCls} />
          </div>
          <button type="submit" disabled={loading}
            className="bg-ink text-cream px-10 py-3.5 text-[11px] font-sans font-medium tracking-[0.22em] uppercase hover:bg-ink/90 transition-colors disabled:opacity-50">
            {loading ? "Submitting…" : "Subscribe"}
          </button>
        </form>
      </div>
    </section>
  );
}
