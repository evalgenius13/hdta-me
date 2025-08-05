// Demographics filter management
class Demographics {
    constructor() {
        this.filters = {
            age: 'millennial',
            income: '30-60k',
            housing: 'renter',
            education: null, // NEW: No default for education
            location: 'virginia',
            zipcode: '', // NEW: Zip code field
            race: 'white'
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
            international: 'International',
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
                
                if (window.newsManager && window.newsManager.articles.length > 0) {
                    window.newsManager.refresh();
                }
            });
        }

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
        filterGroup.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        button.classList.add('active');
        
        this.filters[filterType] = filterValue;
        this.updateDisplay();
        
        if (window.newsManager && window.newsManager.articles.length > 0) {
            window.newsManager.refresh();
        }
    }

    updateDisplay() {
        const parts = [];
        
        parts.push(this.labels[this.filters.age]);
        parts.push(this.labels[this.filters.income]);
        parts.push(this.labels[this.filters.housing]);
        
        // NEW: Add education if selected
        if (this.filters.education) {
            parts.push(this.labels[this.filters.education]);
        }
        
        // NEW: Add location with zip if provided
        if (this.filters.zipcode) {
            parts.push(`${this.labels[this.filters.location]} (${this.filters.zipcode})`);
        } else {
            parts.push(this.labels[this.filters.location]);
        }
        
        parts.push(this.labels[this.filters.race]);
        
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
            housing: this.filters.housing,
            education: this.filters.education, // NEW
            location: this.filters.location,
            zipcode: this.filters.zipcode, // NEW
            race: this.filters.race,
            display: this.getDisplayString()
        };
    }

    getDisplayString() {
        let display = `${this.labels[this.filters.age]} earning ${this.labels[this.filters.income]}, ${this.labels[this.filters.housing]}`;
        
        // NEW: Add education if selected
        if (this.filters.education) {
            display += ` with ${this.labels[this.filters.education]}`;
        }
        
        display += ` in ${this.labels[this.filters.location]}`;
        
        // NEW: Add zip if provided
        if (this.filters.zipcode) {
            display += ` (${this.filters.zipcode})`;
        }
        
        display += `, ${this.labels[this.filters.race]}`;
        
        return display;
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

        // NEW: Education descriptions
        const educationDescriptions = {
            'high-school': 'with high school education, focused on practical job impacts',
            'some-college': 'with some college education, balancing debt and career growth',
            'bachelors': 'with bachelor\'s degree, concerned with professional advancement',
            'graduate': 'with graduate education, focused on specialized career impacts'
        };

        return {
            age: ageDescriptions[this.filters.age],
            income: incomeDescriptions[this.filters.income],
            housing: housingDescriptions[this.filters.housing],
            education: this.filters.education ? educationDescriptions[this.filters.education] : null, // NEW
            location: this.filters.location,
            zipcode: this.filters.zipcode, // NEW
            race: this.filters.race
        };
    }
}

// ✅ FIX: Instantiate after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.demographics = new Demographics();
});
