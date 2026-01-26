-- Create contestants table
CREATE TABLE public.contestants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  photo_url TEXT,
  votes INTEGER NOT NULL DEFAULT 0,
  unique_slug TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create votes table to track each vote transaction
CREATE TABLE public.votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contestant_id UUID NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  vote_count INTEGER NOT NULL DEFAULT 1,
  amount_paid INTEGER NOT NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  voter_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create contest settings table for countdown and other config
CREATE TABLE public.contest_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default contest end date (30 days from now)
INSERT INTO public.contest_settings (setting_key, setting_value)
VALUES ('contest_end_date', (now() + interval '30 days')::text);

-- Insert vote price
INSERT INTO public.contest_settings (setting_key, setting_value)
VALUES ('vote_price', '50');

-- Enable RLS on all tables
ALTER TABLE public.contestants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_settings ENABLE ROW LEVEL SECURITY;

-- Contestants: Anyone can view, anyone can insert (for registration)
CREATE POLICY "Anyone can view contestants" ON public.contestants FOR SELECT USING (true);
CREATE POLICY "Anyone can register contestants" ON public.contestants FOR INSERT WITH CHECK (true);

-- Votes: Anyone can view, anyone can insert (after payment)
CREATE POLICY "Anyone can view votes" ON public.votes FOR SELECT USING (true);
CREATE POLICY "Anyone can add votes" ON public.votes FOR INSERT WITH CHECK (true);

-- Contest settings: Anyone can view
CREATE POLICY "Anyone can view contest settings" ON public.contest_settings FOR SELECT USING (true);

-- Create storage bucket for contestant photos
INSERT INTO storage.buckets (id, name, public) VALUES ('contestant-photos', 'contestant-photos', true);

-- Storage policies for contestant photos
CREATE POLICY "Anyone can view contestant photos" ON storage.objects FOR SELECT USING (bucket_id = 'contestant-photos');
CREATE POLICY "Anyone can upload contestant photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'contestant-photos');

-- Function to update votes count on contestants table
CREATE OR REPLACE FUNCTION public.update_contestant_votes()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.contestants 
  SET votes = votes + NEW.vote_count 
  WHERE id = NEW.contestant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to auto-update votes
CREATE TRIGGER on_vote_added
AFTER INSERT ON public.votes
FOR EACH ROW
EXECUTE FUNCTION public.update_contestant_votes();