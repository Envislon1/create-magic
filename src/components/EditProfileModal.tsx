import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface EditProfileModalProps {
  contestant: {
    id: string;
    full_name: string;
    age: number;
    sex: string;
    photo_url: string | null;
  };
  onUpdate: () => void;
}

export function EditProfileModal({ contestant, onUpdate }: EditProfileModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState(contestant.full_name);
  const [age, setAge] = useState(contestant.age.toString());
  const [sex, setSex] = useState(contestant.sex);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(contestant.photo_url);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let photoUrl = contestant.photo_url;

      // Upload new photo if selected
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${contestant.id}-${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('contestant-photos')
          .upload(fileName, photoFile, { upsert: true });

        if (uploadError) {
          throw new Error("Failed to upload photo");
        }

        const { data: urlData } = supabase.storage
          .from('contestant-photos')
          .getPublicUrl(fileName);
        
        photoUrl = urlData.publicUrl;
      }

      // Update contestant record
      const { error: updateError } = await supabase
        .from("contestants")
        .update({
          full_name: fullName.trim(),
          age: parseInt(age),
          sex,
          photo_url: photoUrl,
        })
        .eq("id", contestant.id);

      if (updateError) {
        throw new Error("Failed to update profile");
      }

      toast({
        title: "Profile Updated",
        description: "Your changes have been saved successfully.",
      });
      
      setOpen(false);
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="absolute bottom-0 right-0 bg-white rounded-full p-2 shadow-lg hover:bg-gray-100 transition-colors border-2 border-section-blue"
          aria-label="Edit profile"
        >
          <Pencil className="w-4 h-4 text-section-blue" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-section-blue border-white/20 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Edit Profile</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Photo Preview */}
          <div className="flex justify-center">
            <label className="cursor-pointer relative group">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Profile preview"
                  className="w-24 h-24 rounded-full object-cover border-2 border-white/50"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-3xl border-2 border-white/50">
                  👶
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil className="w-6 h-6 text-white" />
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-center text-sm text-white/70">Click photo to change</p>

          {/* Full Name */}
          <div className="space-y-2">
            <Label htmlFor="fullName" className="text-white">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="bg-white/10 border-white/30 text-white placeholder:text-white/50"
              required
            />
          </div>

          {/* Age */}
          <div className="space-y-2">
            <Label htmlFor="age" className="text-white">Age (years)</Label>
            <Input
              id="age"
              type="number"
              min="0"
              max="12"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="bg-white/10 border-white/30 text-white placeholder:text-white/50"
              required
            />
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label className="text-white">Gender</Label>
            <Select value={sex} onValueChange={setSex}>
              <SelectTrigger className="bg-white/10 border-white/30 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Boy</SelectItem>
                <SelectItem value="female">Girl</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-section-blue hover:bg-gray-100"
          >
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
