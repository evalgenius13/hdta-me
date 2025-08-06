// Demographics filter management - Fixed to not reload articles
class Demographics {
    constructor() {
        this.filters = {
            age: 'millennial',
            income: '30-60k',
            location: 'virginia'
        };

        this.labels = {
            genz: 'Gen Z',
            millennial: 'Millennial', 
            genx: 'Gen X',
            boomer: 'Boomer',
            'under30k': 'Under $30K',
            '30-60k': '$30K-$60K',
            '60-100k': '$60K-$100K',
            '100k-1m': '$100K-$1M',
            'over1m': 'Over $1M',
            alabama: 'Alabama',
            alaska: 'Alaska',
            arizona: 'Arizona',
            arkansas: 'Arkansas',
            california: 'California',
            colorado: 'Colorado',
            connecticut: 'Connecticut',
            delaware: 'Delaware',
            florida: 'Florida',
            georgia: 'Georgia',
            hawaii: 'Hawaii',
            idaho: 'Idaho',
            illinois: 'Illinois',
            indiana: 'Indiana',
            iowa: 'Iowa',
            kansas: 'Kansas',
            kentucky: 'Kentucky',
            louisiana: 'Louisiana',
            maine: 'Maine',
            maryland: 'Maryland',
            massachusetts: 'Massachusetts',
            michigan: 'Michigan',
            minnesota: 'Minnesota',
            mississippi: 'Mississippi',
            missouri: 'Missouri',
            montana: 'Montana',
            nebraska: 'Nebraska',
            nevada: 'Nevada',
            newhampshire: 'New Hampshire',
            newjersey: 'New Jersey',
            newmexico: 'New Mexico',
            newyork: 'New York',
            northcarolina: 'North Carolina',
            northdakota: 'North Dakota',
            ohio: 'Ohio',
            oklahoma: 'Oklahoma',
            oregon: 'Oregon',
            pennsylvania: 'Pennsylvania',
            rhodeisland: 'Rhode Island',
            southcarolina: 'South Carolina',
            southdakota: 'South Dakota',
            tennessee: 'Tennessee',
            texas: 'Texas',
            utah: 'Utah',
            vermont: 'Vermont',
            virginia: 'Virginia',
            washington: 'Washington',
            westvirginia: 'West Virginia',
            wisconsin: 'Wisconsin',
            wyoming: 'Wyoming',
            dc: 'Washington DC',
            international: 'International'
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

        // Handle location dropdown
        const locationSelect = document.getElementById('location-select');
        if (locationSelect) {
            locationSelect.addEventListener('change', (e) => {
                this.filters.location = e.target.value;
                this.updateDisplay();
                this.clearExistingAnalysis(); // Clear old analysis, but keep articles
            });
        }
    }

    handleFilterClick(button) {
        const filterType = button.dataset.filter;
        const filterValue = button.dataset.value;
        
        const filterGroup = button.closest('.filter-group');
        filterGroup.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        button.classList.add('active');
        
        this.filters[filterType] = filterValue;
        this.updateDisplay();
        
        // Clear existing analysis but DON'T reload articles
        this.clearExistingAnalysis();
    }

    clearExistingAnalysis() {
        // Clear all existing "How Does This Affect Me?" responses
        // so they regenerate with new demographics, but keep the articles
        const impactElements = document.querySelectorAll('[id^="impact-"]');
        impactElements.forEach(element => {
            element.innerHTML = '';
        });

        // Clear personalization cache if it exists
        if (window.personalization) {
            window.personalization.clearCache();
        }
    }

    updateDisplay() {
        const parts = [];
        
        parts.push(this.labels[this.filters.age]);
        parts.push(this.labels[this.filters.income]);
        
        // Add location with zip if provided
        if (this.filters.zipcode) {
            parts.push(`${this.labels[this.filters.location]} (${this.filters.zipcode})`);
        } else {
            parts.push(this.labels[this.filters.location]);
        }
        
        const display = parts.join(' • ');
        const demoElement = document.getElementById('current-demo');
        if (demoElement) {
            demoElement.textContent = display;
        }
    }

    getProfile() {
        return {
            age: this.filters.age,
            income: this.filters.income,
            location: this.filters.location,
            display: this.getDisplayString()
        };
    }

    getDisplayString() {
        return `${this.labels[this.filters.age]} earning ${this.labels[this.filters.income]} in ${this.labels[this.filters.location]}`;
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
            '30-60k': 'earning $30K-$60K annually, middle-class income with budget considerations',
            '60-100k': 'earning $60K-$100K annually, comfortable middle to upper-middle class',
            '100k-1m': 'earning $100K-$1M annually, high income with investment opportunities',
            'over1m': 'earning over $1M annually, wealthy with significant assets'
        };

        return {
            age: ageDescriptions[this.filters.age],
            income: incomeDescriptions[this.filters.income],
            location: this.filters.location
        };
    }
}

// Initialize after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.demographics = new Demographics();
});
