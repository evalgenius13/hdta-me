// Demographics filter management
class Demographics {
    constructor() {
        this.filters = {
            age: 'millennial',
            income: '30-60k',
            housing: 'renter',
            location: 'virginia'
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
            virginia: 'Virginia'
        };

        this.init();
    }

    init() {
        this.attachEventListeners();
        this.updateDisplay();
    }

    attachEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-btn')) {
                this.handleFilterClick(e.target);
            }
        });
    }

    handleFilterClick(button) {
        const filterType = button.dataset.filter;
        const filterValue = button.dataset.value;
        
        // Update active state in UI
        const filterGroup = button.closest('.filter-group');
        filterGroup.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        button.classList.add('active');
        
        // Update filter state
        this.filters[filterType] = filterValue;
        this.updateDisplay();
        
        // Trigger personalization update if news is loaded
        if (window.newsManager && window.newsManager.articles.length > 0) {
            window.newsManager.updatePersonalization();
        }
    }

    updateDisplay() {
        const display = `${this.labels[this.filters.age]} • ${this.labels[this.filters.income]} • ${this.labels[this.filters.housing]} • ${this.labels[this.filters.location]}`;
        const demoElement = document.getElementById('current-demo');
        if (demoElement) {
            demoElement.textContent = display;
        }
    }

    getProfile() {
        return {
            age: this.filters.age,
            income: this.filters.income,
            housing: this.filters.housing,
            location: this.filters.location,
            display: `${this.labels[this.filters.age]} earning ${this.labels[this.filters.income]}, ${this.labels[this.filters.housing]} in ${this.labels[this.filters.location]}`
        };
    }

    getDetailedProfile() {
        const ageDescriptions = {
            genz: 'Gen Z (born 1997-2012), digital natives who value authenticity and social justice',
            millennial: 'Millennial (born 1981-1996), tech-savvy with student loans and home-buying challenges',
            genx: 'Gen X (born 1965-1980), sandwich generation balancing kids and aging parents',
            boomer: 'Baby Boomer (born 1946-1964), established in career or retired, focused on stability'
        };

        const incomeDescriptions = {
            'under30k': 'earning under $30K annually, likely entry-level or part-time work',
            '30-60k': 'earning $30-60K annually, middle-class income with budget considerations',
            '60-100k': 'earning $60-100K annually, comfortable middle to upper-middle class',
            '100k+': 'earning over $100K annually, higher income with investment opportunities'
        };

        const housingDescriptions = {
            renter: 'renting their home, affected by rental market changes and mobility',
            owner: 'owning their home, affected by property values and mortgage rates',
            family: 'living with family, sharing housing costs and decisions'
        };

        return {
            age: ageDescriptions[this.filters.age],
            income: incomeDescriptions[this.filters.income],
            housing: housingDescriptions[this.filters.housing],
            location: this.filters.location
        };
    }
}

// Initialize demographics when DOM is loaded
if (typeof window !== 'undefined') {
    window.demographics = null;
}
