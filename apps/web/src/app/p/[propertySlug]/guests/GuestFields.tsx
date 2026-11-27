import { Field, TextArea } from "@/components/ui";

export function GuestFields({ g }: { g?: { firstName: string; lastName: string; email: string | null; mobile: string | null; nationality: string | null; address: string | null; birthDate: string | null; company: string | null; notes: string | null; marketingConsent: boolean } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="First name" name="firstName" defaultValue={g?.firstName} required />
      <Field label="Last name" name="lastName" defaultValue={g?.lastName} required />
      <Field label="Email" name="email" type="email" defaultValue={g?.email ?? ""} />
      <Field label="Mobile" name="mobile" defaultValue={g?.mobile ?? ""} placeholder="0917 123 4567" />
      <Field label="Nationality" name="nationality" defaultValue={g?.nationality ?? "PH"} maxLength={2} hint="2-letter code, e.g. PH, US, JP" />
      <Field label="Birth date" name="birthDate" type="date" defaultValue={g?.birthDate ?? ""} />
      <Field label="Company" name="company" defaultValue={g?.company ?? ""} />
      <Field label="Address" name="address" defaultValue={g?.address ?? ""} />
      <TextArea label="Notes" name="notes" defaultValue={g?.notes ?? ""} className="sm:col-span-2" />
      <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" name="marketingConsent" defaultChecked={g?.marketingConsent} /> Agrees to receive offers by email or SMS</label>
    </div>
  );
}
