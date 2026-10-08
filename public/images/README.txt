HOME PAGE PHOTO
===============

The Home page uses public/images/hero.jpg as its full-screen background.
The current photo is the NYSE trading floor by Jamal Eid / NYSE, used with
permission. Keep the permission message in case a judge asks about it.

To change the photo
-------------------
1. Pick a landscape photo, ideally at least 2400 pixels wide, JPG, under
   about 1 MB. The title panel sits in the lower left, so a calm area there
   reads best.
2. Name it exactly: hero.jpg
3. On github.com open the repository, go into public > images, click
   Add file > Upload files, drop the photo in and click Commit changes.
   Uploading a file with the same name replaces the old one. Vercel puts it
   online in about a minute.
4. Update the credit in two places:
   - public/index.html, the line under <!-- EDIT PHOTO CREDIT -->
   - public/js/footer.js, "photographer" at the top
5. If the wrong part of the photo shows, change --photo-position in
   public/css/home.css (EDIT PHOTO POSITION).

Only use photos you have permission for: your own, ones you were given
permission to use, Unsplash (free under the Unsplash license), or Wikimedia
Commons (usually requires a credit with the photographer's name).
