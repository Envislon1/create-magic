import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface RegistrationFormProps {
  onSuccess: (slug: string) => void;
}

export function RegistrationForm({ onSuccess }: RegistrationFormProps) {
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !age || !sex) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      let photoUrl = null;

      if (photo) {
        const fileExt = photo.name.split(".").pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        
        const { error: uploadError, data } = await supabase.storage
          .from("contestant-photos")
          .upload(fileName, photo);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("contestant-photos")
          .getPublicUrl(fileName);

        photoUrl = urlData.publicUrl;
      }

      const { data, error } = await supabase
        .from("contestants")
        .insert({
          full_name: fullName,
          age: parseInt(age),
          sex: sex,
          photo_url: photoUrl,
          whatsapp_contact: whatsappContact || null,
        })
        .select("unique_slug")
        .single();

      if (error) throw error;

      toast({ title: "Registration successful!" });
      onSuccess(data.unique_slug);
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-4 text-white">Register Your Child</h2>
      
      <div>
        <label className="block text-sm mb-1 text-white/90">Full Name *</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full border border-white/30 p-2 rounded bg-white/10 text-white placeholder:text-white/50"
          required
        />
      </div>

      <div>
        <label className="block text-sm mb-1 text-white/90">Age *</label>
        <select
          value={age}
          onChange={(e) => setAge(e.target.value)}
          className="w-full border border-white/30 p-2 rounded bg-white/10 text-white"
          required
        >
          <option value="" className="bg-section-blue text-white">Select Age</option>
          <option value="0" className="bg-section-blue text-white">Under 1</option>
          {Array.from({ length: 9 }, (_, i) => i + 1).map((year) => (
            <option key={year} value={year.toString()} className="bg-section-blue text-white">
              {year} year{year !== 1 ? 's' : ''} old
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm mb-1 text-white/90">Sex *</label>
        <select
          value={sex}
          onChange={(e) => setSex(e.target.value)}
          className="w-full border border-white/30 p-2 rounded bg-white/10 text-white"
          required
        >
          <option value="" className="bg-section-blue text-white">Select</option>
          <option value="male" className="bg-section-blue text-white">Male</option>
          <option value="female" className="bg-section-blue text-white">Female</option>
        </select>
      </div>

      <div>
        <label className="block text-sm mb-1 text-white/90">WhatsApp Contact</label>
        <input
          type="tel"
          value={whatsappContact}
          onChange={(e) => setWhatsappContact(e.target.value)}
          placeholder="e.g. 08012345678"
          className="w-full border border-white/30 p-2 rounded bg-white/10 text-white placeholder:text-white/50"
        />
      </div>

      <div>
        <label className="block text-sm mb-1 text-white/90">Photo</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] || null)}
          className="w-full border border-white/30 p-2 rounded bg-white/10 text-white file:bg-white file:text-section-blue file:border-0 file:rounded file:mr-2"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-white text-section-blue p-2 rounded font-medium disabled:opacity-50 hover:bg-gray-100 transition"
      >
        {loading ? "Registering..." : "Register"}
      </button>
    </form>
  );
}
