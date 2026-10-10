Project X Contractors LLC - public website pages

Run "npm run dev" in project-x-app and open http://localhost:5173/ (the Work page is the home page).
- Public pages (clean addresses): / (work), /about, /careers, /contact, /privacy, /step-2-quote, /step-5-delivery, plus 404.html
- Admin pages live in ../admin and are served at /admin/<page>
- Images: ../assets (logo, project photos, favicons, link preview image)

The pages are plain HTML; forms, the gallery, quotes and the admin panel are powered by src/page-runtime.ts and the backend API.
See ../../README.md for setup and deployment.
