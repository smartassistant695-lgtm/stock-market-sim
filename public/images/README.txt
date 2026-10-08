Home page photo
===============

The home page (public/index.html) shows a large photo of the Charging Bull
statue on Wall Street. Until the file exists, the page shows a grey box that
says "Add your licensed photo here".

1. Use a photo you are allowed to use: your own photo, or one with a license
   that allows reuse (for example Creative Commons on Wikimedia Commons).
   Write down the photographer's name and the license.

2. Save it with exactly this name, in this folder:

       public/images/charging-bull.jpg

   (all lowercase, ".jpg" not ".jpeg" or ".png").

3. Recommended size: 2400 x 1050 pixels (a wide 16:7 shape), JPG,
   under 500 KB. Other sizes work too; the page crops the photo to 16:7
   from the center, so keep the bull near the middle.

4. Update the credit line under the photo. Open public/index.html and find
   the line after <!-- EDIT PHOTO CREDIT -->:

       Photo: [Photographer name], [license]

   Replace it, for example: Photo: Jane Doe, CC BY-SA 4.0

5. Upload the photo to GitHub (open this repository on github.com, go into
   the public/images folder, Add file > Upload files, Commit changes).
   Vercel updates the site about a minute later.
