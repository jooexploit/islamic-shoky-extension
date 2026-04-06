/* global document, window, IntersectionObserver */

const menuToggle = document.getElementById("menu-toggle");
const siteNav = document.getElementById("site-nav");
const siteHeader = document.querySelector(".site-header");
const navLinks = Array.from(
  document.querySelectorAll('.site-nav a[href^="#"]'),
);
const sectionNodes = Array.from(document.querySelectorAll("main section[id]"));

if (menuToggle && siteNav) {
  menuToggle.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    siteNav.classList.toggle("is-open", !expanded);
  });

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuToggle.setAttribute("aria-expanded", "false");
      siteNav.classList.remove("is-open");
    });
  });
}

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const getHeaderOffset = () => {
  const headerHeight = siteHeader ? siteHeader.offsetHeight : 0;
  return headerHeight + 12;
};

const updateActiveLink = () => {
  if (navLinks.length === 0 || sectionNodes.length === 0) {
    return;
  }

  const checkpoint = window.scrollY + getHeaderOffset() + 12;
  let activeId = sectionNodes[0].id;

  sectionNodes.forEach((section) => {
    if (section.offsetTop <= checkpoint) {
      activeId = section.id;
    }
  });

  navLinks.forEach((link) => {
    const targetId = link.getAttribute("href").slice(1);
    link.classList.toggle("is-active", targetId === activeId);
  });
};

const internalAnchors = Array.from(
  document.querySelectorAll('a[href^="#"]:not([href="#"])'),
);

internalAnchors.forEach((link) => {
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href");
    const target = href ? document.querySelector(href) : null;

    if (!target) {
      return;
    }

    event.preventDefault();

    const targetTop =
      target.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });

    if (!prefersReducedMotion) {
      target.classList.remove("section-focus");
      void target.offsetWidth;
      target.classList.add("section-focus");
      window.setTimeout(() => {
        target.classList.remove("section-focus");
      }, 760);
    }

    if (menuToggle && siteNav.classList.contains("is-open")) {
      menuToggle.setAttribute("aria-expanded", "false");
      siteNav.classList.remove("is-open");
    }
  });
});

if (!prefersReducedMotion) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -8% 0px",
    },
  );

  const registerRevealGroup = (selector, direction) => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach((el, index) => {
      el.setAttribute("data-reveal", direction);
      el.style.setProperty("--reveal-delay", `${Math.min(index * 70, 420)}ms`);
      revealObserver.observe(el);
    });
  };

  registerRevealGroup(".hero", "zoom");
  registerRevealGroup(".section", "up");
  registerRevealGroup(".site-footer", "up");
  registerRevealGroup(".hero-copy > *", "left");
  registerRevealGroup(".hero-visual", "right");
  registerRevealGroup(".pillar-card", "up");
  registerRevealGroup(".feature-card", "up");
  registerRevealGroup(".placeholder-card", "up");
  registerRevealGroup(".install-steps li", "left");
  registerRevealGroup(".install-card", "right");
  registerRevealGroup(".dev-links li", "left");
  registerRevealGroup(".quote-card", "zoom");
  registerRevealGroup(".cta-wrap > *", "up");
} else {
  document.querySelectorAll("[data-reveal]").forEach((el) => {
    el.classList.add("is-visible");
  });
}

window.addEventListener("scroll", updateActiveLink, { passive: true });
window.addEventListener("resize", updateActiveLink);
updateActiveLink();
