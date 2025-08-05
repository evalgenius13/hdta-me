// Demographics filter management
class Demographics {
    constructor() {
        this.filters = {
            age: null,
            income: null,
            housing: null,
            education: null,
            location: 'virginia',
            zipcode: '',
            race: null
        };

        this.labels = {
            genz: 'Gen Z',
            millennial: 'Millennial', 
            genx: 'Gen X',
            boomer: 'Boomer',
            'under30k': 'Under $30K',
            '30-60k': '$30-60K',
            '60-100k': '$60-100K',
            '100k+': '$100K+',
            renter: 'Renter',
            owner: 'Owner',
            family: 'With Family',
            'high-school': 'High School',
            'some-college': 'Some College',
            'bachelors': 'Bachelor\'s',
            'graduate': 'Graduate',
            virginia: 'Virginia',
            california: 'California',
            texas: 'Texas',
            florida: 'Florida',
            newyork: 'New York',
            other: 'Other State',
            white: 'White',
            black: 'Black',
            hispanic: 'Hispanic',
            asian: 'Asian',
            other: 'Other'
        };

        this.init();
    }

    init() {
        this.attachEventListeners();
        this.updateDisplay();
        this.setupToggle();
    }

    setupToggle() {
        // Add toggle functionality
        const toggleBtn = document.querySelector('.demographics-toggle');
        const demoBar = document.querySelector('.demographics-bar');
        
        if (toggleBtn && demoBar) {
            toggleBtn.addEventListener('click', () => {
                const isHidden = demoBar.style.display === 'none';
                demoBar.style.display = isHidden ? 'block' : 'none';
                toggleBtn.textContent = isHidden ? 'Hide Profile' : 'Customize Profile';
            });
        }
    }

    attachEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-btn')) {
                this.handleFilterClick(e.target);
            }
        });

        // Handle zip code input
        const zipInput = document.getElementById('zipcode-input');
        if (zipInput) {
            zipInput.addEventListener('input', (e) => {
                this.filters.zipcode = e.target.value;
                this.updateDisplay();
                if (window.newsManager && window.newsManager.articles.length > 0) {
                    window.newsManager.refresh();
                }
            });
        }
    }

    handleFilterClick(button) {
        const filterType = button.dataset.filter;
        const filterValue = button.dataset.value;
        
        const filterGroup = button.closest('.filter-group');
        const allButtons = filterGroup.querySelectorAll('.filter-btn');
        
        // If clicking the same button, deselect it
        if (button.classList.contains('active')) {
            button.classList.remove('active');
            this.filters[filterType] = null;
        } else {
            // Deselect all others, select this one
            allButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.filters[filterType] = filterValue;
        }
        
        this.updateDisplay();
        
        if (window.newsManager && window.newsManager.articles.length > 0) {
            window.newsManager.refresh();
        }
    }

    updateDisplay() {
        const parts = [];
        
        if (this.filters.age) parts.push(this.labels[this.filters.age]);
        if (this.filters.income) parts.push(this.labels[this.filters.income]);
        if (this.filters.housing) parts.push(this.labels[this.filters.housing]);
        if (this.filters.education) parts.push(this.labels[this.filters.education]);
        if (this.filters.location) {
            const locationText = this.labels[this.filters.location];
            if (this.filters.zipcode) {
                parts.push(`${locationText} (${this.filters.zipcode})`);
            } else {
                parts.push(locationText);
            }
        }
        if (this.filters.race) parts.push(this.labels[this.filters.race]);
        
        const display = parts.length > 0 ? parts.join(' • ') : 'General Audience';
        const demoElement = document.getElementById('current-demo');
        if (demoElement) {
            demoElement.textContent = display;
        }
    }

    getProfile() {
        return {
            age: this.filters.age || 'general',
            income: this.filters.income || 'general',
            housing: this.filters.housing || 'general',
            education: this.filters.education || 'general',
            location: this.filters.location || 'general',
            zipcode: this.filters.zipcode || '',
            race: this.filters.race || 'general'
        };
    }

    getDetailedProfile() {
        const ageDescriptions = {
            genz: 'Gen Z (born 1997-2012), digital natives who value authenticity and social justice',
            millennial: 'Millennial (born 1981-1996), tech-savvy with student loans and home-buying challenges',
            genx: 'Gen X (born 1965-1980), sandwich generation balancing kids and aging parents',
            boomer: 'Baby Boomer (born 1946-1964), established in career or retired, focused on stability',
            general: 'general audience member'
        };

        const incomeDescriptions = {
            'under30k': 'earning under $30K annually, likely entry-level or part-time work',
            '30-60k': 'earning $30-60K annually, middle-class income with budget considerations',
            '60-100k': 'earning $60-100K annually, comfortable middle to upper-middle class',
            '100k+': 'earning over $100K annually, higher income with investment opportunities',
            general: 'with typical American income'
        };

        const housingDescriptions = {
            renter: 'renting their home, affected by rental market changes and mobility',
            owner: 'owning their home, affected by property values and mortgage rates',
            family: 'living with family, sharing housing costs and decisions',
            general: 'with typical housing situation'
        };

        const educationDescriptions = {
            'high-school': 'with high school education, focused on practical job market impacts',
            'some-college': 'with some college education, balancing debt and career growth',
            'bachelors': 'with bachelor\'s degree, concerned with professional advancement',
            'graduate': 'with graduate education, focused on specialized career impacts',
            general: 'with typical education background'
        };

        return {
            age: ageDescriptions[this.filters.age] || ageDescriptions.general,
            income: incomeDescriptions[this.filters.income] || incomeDescriptions.general,
            housing: housingDescriptions[this.filters.housing] || housingDescriptions.general,
            education: educationDescriptions[this.filters.education] || educationDescriptions.general,
            location: this.filters.location || 'general',
            zipcode: this.filters.zipcode || '',
            race: this.filters.race || 'general'
        };
    }
}

// Initialize after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.demographics = new Demographics();
});
